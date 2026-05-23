/**
 * ElevenLabs mid-call tool handler — single endpoint for all tools.
 * POST ?tool=<tool_name> with JSON body.
 *
 * Handles both phone calls and web chat via the same lookup_caller_phone tool.
 * Creates contacts for new callers, links enquiries to conversations,
 * allocates practitioners by seniority, sends SMS/email confirmations.
 *
 * Changes:
 *   2026-03-20: Full refactor — practice fallback, parallelized queries,
 *               flat slot fields, contact auto-creation, sort_order ranking,
 *               web chat support, no human handoff language.
 *   2026-03-10: Initial creation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getUKDateTime } from "../_shared/clock.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";

// deno-lint-ignore no-explicit-any
type DB = any;

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, "").trim();
  if (p.startsWith("0") && p.length >= 10) p = "+44" + p.slice(1);
  if (p.match(/^44\d{9,}$/) && !p.startsWith("+")) p = "+" + p;
  return p;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// ═══════════════════════════════════════════════════════════════
// Practice hours
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
function findNextOpen(openingHours: any[], holidayHours: any[], fromISO: string) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const from = new Date(fromISO + "T12:00:00Z");
  for (let i = 1; i <= 7; i++) {
    const next = new Date(from.getTime() + i * 86400000);
    const iso = next.toISOString().slice(0, 10);
    const holiday = (holidayHours || []).find((h: { date: string }) => h.date === iso);
    if (holiday && !holiday.is_open) continue;
    const dayName = days[next.getUTCDay()];
    const hours = (openingHours || []).find((h: { day: string }) => h.day === dayName);
    if (hours && hours.is_open) return { day: dayName, date: iso, open_time: hours.open_time };
  }
  return null;
}

// deno-lint-ignore no-explicit-any
function getPracticeHoursStatus(openingHours: any[], holidayHours: any[]) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find(p => p.type === "weekday")?.value || "";
  const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0");
  const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0");
  const currentMinutes = hour * 60 + minute;
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const dfmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
  const dp = dfmt.formatToParts(now);
  const todayISO = `${dp.find(p => p.type === "year")?.value}-${dp.find(p => p.type === "month")?.value}-${dp.find(p => p.type === "day")?.value}`;

  const holiday = (holidayHours || []).find((h: { date: string }) => h.date === todayISO);
  if (holiday) {
    if (!holiday.is_open) return { is_open_now: false, current_time: timeStr, today_hours: null, is_holiday: true, holiday_label: holiday.label || "Holiday", next_open: findNextOpen(openingHours, holidayHours, todayISO) };
    const hOpen = timeToMinutes(holiday.open_time || "09:00"), hClose = timeToMinutes(holiday.close_time || "17:00");
    const isOpen = currentMinutes >= hOpen && currentMinutes < hClose;
    return { is_open_now: isOpen, current_time: timeStr, today_hours: { open_time: holiday.open_time, close_time: holiday.close_time }, closes_in_minutes: isOpen ? hClose - currentMinutes : 0, closing_soon: isOpen && hClose - currentMinutes <= 30, is_holiday: true, next_open: isOpen ? null : findNextOpen(openingHours, holidayHours, todayISO) };
  }

  const todayHours = (openingHours || []).find((h: { day: string }) => h.day.toLowerCase() === weekday.toLowerCase());
  if (!todayHours || !todayHours.is_open) return { is_open_now: false, current_time: timeStr, today_hours: null, next_open: findNextOpen(openingHours, holidayHours, todayISO) };

  const openMin = timeToMinutes(todayHours.open_time), closeMin = timeToMinutes(todayHours.close_time);
  const isOpen = currentMinutes >= openMin && currentMinutes < closeMin;
  return { is_open_now: isOpen, current_time: timeStr, today_hours: { open_time: todayHours.open_time, close_time: todayHours.close_time }, closes_in_minutes: isOpen ? closeMin - currentMinutes : 0, closing_soon: isOpen && closeMin - currentMinutes <= 30, next_open: isOpen ? null : findNextOpen(openingHours, holidayHours, todayISO) };
}

// ═══════════════════════════════════════════════════════════════
// Practice loader (with 30s in-memory cache)
// ═══════════════════════════════════════════════════════════════

const PRACTICE_COLS = "id, name, email, phone, website, opening_hours, holiday_hours, integrations, practitioners, price_list, usps, practice_plan, clinic_guidelines, agent_tone, twilio_phone_number, messaging_service_sid, twilio_sms_number, elevenlabs_agent_id";

// deno-lint-ignore no-explicit-any
const practiceCache = new Map<string, { data: any; expiresAt: number }>();

async function loadPractice(db: DB, opts: { practiceId?: string; twilioNumber?: string; agentId?: string }) {
  if (opts.practiceId) {
    const cached = practiceCache.get(opts.practiceId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
  }

  // deno-lint-ignore no-explicit-any
  let practice: any = null;
  if (opts.practiceId) { const { data } = await db.from("practices").select(PRACTICE_COLS).eq("id", opts.practiceId).single(); practice = data; }
  if (!practice && opts.twilioNumber) { const { data } = await db.from("practices").select(PRACTICE_COLS).eq("twilio_phone_number", opts.twilioNumber).single(); practice = data; }
  if (!practice && opts.agentId) { const { data } = await db.from("practices").select(PRACTICE_COLS).eq("elevenlabs_agent_id", opts.agentId).single(); practice = data; }

  if (practice) practiceCache.set(practice.id, { data: practice, expiresAt: Date.now() + 30000 });
  return practice;
}

// deno-lint-ignore no-explicit-any
function buildPracticeBase(practice: any) {
  const integrations = practice.integrations || {};
  return {
    success: true, practice_id: practice.id, practice_name: practice.name,
    practice_email: practice.email || integrations.email_from || null,
    practice_phone: practice.phone, practice_website: practice.website,
    practice_hours: getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours),
    practice_usps: practice.usps || null,
    practice_plan: practice.practice_plan?.offered ? practice.practice_plan.terms : null,
    clinic_guidelines: practice.clinic_guidelines || null,
    agent_tone: practice.agent_tone || null,
    practitioners: (practice.practitioners || []).map((p: { title?: string; name: string; credentials?: string; bio?: string; services?: string[] }) => ({
      name: `${p.title || ""} ${p.name}`.trim(), credentials: p.credentials || null,
      bio: (p.bio || "").slice(0, 150) + ((p.bio || "").length > 150 ? "..." : ""), services: p.services || [],
    })),
    prices: (practice.price_list || []).map((p: { service_name: string; price: number; is_from_price?: boolean }) => ({
      service: p.service_name, price: p.is_from_price ? `from £${p.price}` : `£${p.price}`,
    })),
    email_enabled: !!integrations.email_enabled, stripe_connected: !!integrations.stripe_connected,
    current_datetime: getUKDateTime(),
    agent_instructions: "You are the full point of contact. Never suggest the patient speaks to a team member, calls back, or tries again later. Always aim to resolve their query and book them into an appointment.",
  };
}

// ═══════════════════════════════════════════════════════════════
// Contact lookup (parallelized)
// ═══════════════════════════════════════════════════════════════

async function findContactByPhone(db: DB, practiceId: string, phone: string) {
  const normalised = normalizePhone(phone);
  const alt = phone.startsWith("+44") ? "0" + phone.slice(3) : phone.startsWith("0") ? "+44" + phone.slice(1) : null;
  const cols = "id, name, phone, email, date_of_birth, address, postcode";

  const queries = [db.from("contacts").select(cols).eq("practice_id", practiceId).eq("phone", phone).limit(1).single()];
  if (normalised !== phone) queries.push(db.from("contacts").select(cols).eq("practice_id", practiceId).eq("phone", normalised).limit(1).single());
  if (alt) queries.push(db.from("contacts").select(cols).eq("practice_id", practiceId).eq("phone", alt).limit(1).single());

  const results = await Promise.all(queries);
  for (const r of results) { if (r.data) return r.data; }
  return null;
}

async function getConversationHistory(db: DB, opts: { contactId?: string; phone?: string; practiceId: string }) {
  const convCols = "channel, status, outcome, summary, caller_name, started_at, duration_seconds";
  let conversations = null;

  if (opts.contactId) {
    const { data } = await db.from("conversations").select(convCols).eq("contact_id", opts.contactId).eq("practice_id", opts.practiceId).order("started_at", { ascending: false }).limit(5);
    conversations = data;
  }
  if ((!conversations || conversations.length === 0) && opts.phone) {
    const { data } = await db.from("conversations").select(convCols).eq("caller_phone", normalizePhone(opts.phone)).eq("practice_id", opts.practiceId).order("started_at", { ascending: false }).limit(5);
    conversations = data;
  }
  if (!conversations || conversations.length === 0) return null;

  const channelLabel: Record<string, string> = { phone: "Phone call", web_chat: "Web chat", sms: "Text message" };
  // deno-lint-ignore no-explicit-any
  const lines = conversations.map((c: any) => {
    const date = new Date(c.started_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return `- ${date} (${channelLabel[c.channel] || c.channel}): ${c.summary || "No summary"}${c.outcome ? ` → ${c.outcome.replace(/_/g, " ")}` : ""}`;
  });
  return "Previous interactions:\n" + lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Slot finder
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function findSlots(db: DB, opts: any) {
  const { practitioners, practice_id, totalMinutes, preference_day, preference_time, preference_date, openingHours, holidayHours, searchDays } = opts;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // deno-lint-ignore no-explicit-any
  const slots: any[] = [];
  const clock = getUKDateTime();
  const todayDate = new Date(clock.date_iso + "T12:00:00Z");

  // Single query for entire window
  const startRange = new Date(todayDate.getTime() + 86400000).toISOString().slice(0, 10);
  const endRange = new Date(todayDate.getTime() + (searchDays + 1) * 86400000).toISOString().slice(0, 10);
  const { data: allExisting } = await db.from("appointments").select("practitioner_id, starts_at, ends_at")
    .eq("practice_id", practice_id).gte("starts_at", `${startRange}T00:00:00`).lt("starts_at", `${endRange}T00:00:00`).neq("status", "cancelled");

  for (let d = 1; d <= searchDays; d++) {
    if (slots.length >= 12) break;
    const date = new Date(todayDate.getTime() + d * 86400000);
    const iso = date.toISOString().slice(0, 10);
    const dayName = days[date.getUTCDay()];

    if (preference_date && iso !== preference_date) continue;
    if (preference_day && dayName.toLowerCase() !== preference_day.toLowerCase()) continue;

    const holiday = (holidayHours || []).find((h: { date: string }) => h.date === iso);
    if (holiday && !holiday.is_open) continue;
    const dayHours = (openingHours || []).find((h: { day: string }) => h.day === dayName);
    if (!dayHours || !dayHours.is_open) continue;

    const existing = (allExisting || []).filter((a: { starts_at: string }) => a.starts_at.slice(0, 10) === iso);

    for (const prac of practitioners) {
      const whArr = Array.isArray(prac.working_hours) ? prac.working_hours : [];
      const wh = whArr.find((w: { day: string }) => w.day === dayName);
      if (whArr.length > 0 && (!wh || !wh.is_working)) continue;

      const startMin = timeToMinutes(wh?.start_time || dayHours.open_time);
      const endMin = timeToMinutes(wh?.end_time || dayHours.close_time);
      const bufferMins = opts.service?.buffer_minutes || 10;
      const blocked = (existing || []).filter((a: { practitioner_id: string }) => a.practitioner_id === prac.id)
        .map((a: { starts_at: string; ends_at: string }) => ({ start: timeToMinutes(a.starts_at.slice(11, 16)), end: timeToMinutes(a.ends_at.slice(11, 16)) + bufferMins }));

      for (let t = startMin; t + totalMinutes <= endMin; t += 15) {
        const slotEnd = t + totalMinutes;
        if (blocked.some((b: { start: number; end: number }) => t < b.end && slotEnd > b.start)) continue;
        if (preference_time) {
          if (preference_time === "morning" && t >= 720) continue;
          if (preference_time === "afternoon" && t < 720) continue;
          if (preference_time.includes(":") && Math.abs(t - timeToMinutes(preference_time)) > 120) continue;
        }
        const startTime = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        const endTime = `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`;
        slots.push({ practitioner_id: prac.id, practitioner_name: prac.name, date: iso, day: dayName, start_time: startTime, end_time: endTime, display: `${dayName} the ${ordinal(date.getUTCDate())} at ${startTime} with ${prac.name.split(" ")[0]}` });
      }
    }
  }
  return slots;
}

// ═══════════════════════════════════════════════════════════════
// SMS + Email confirmation
// ═══════════════════════════════════════════════════════════════

function formatDate(isoDate: string) {
  const d = new Date(isoDate + "T12:00:00Z");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

// deno-lint-ignore no-explicit-any
async function sendConfirmationSms(db: DB, opts: { contactPhone: string; practiceName: string; serviceName: string; date: string; time: string; practitionerName?: string; messagingServiceSid?: string; twilioSmsNumber?: string; smsEnabled?: boolean; practiceId?: string; contactId?: string; enquiryId?: string }) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !opts.contactPhone || opts.smsEnabled === false) return;
  const from = opts.messagingServiceSid || opts.twilioSmsNumber;
  if (!from) return;
  try {
    let body = `Your appointment at ${opts.practiceName} is confirmed:\n\n${opts.serviceName}\n${formatDate(opts.date)} at ${opts.time}`;
    if (opts.practitionerName) body += ` with ${opts.practitionerName}`;
    body += `\n\nIf you need to change or cancel, just reply to this text or chat with us on our website. We look forward to seeing you!`;
    const params: Record<string, string> = { To: opts.contactPhone, Body: body };
    if (opts.messagingServiceSid) params.MessagingServiceSid = opts.messagingServiceSid; else params.From = opts.twilioSmsNumber!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: "POST", headers: { Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const result = await res.json();
    // Track in sms_events
    await db.from("sms_events").insert({
      practice_id: opts.practiceId || null, enquiry_id: opts.enquiryId || null, contact_id: opts.contactId || null,
      sms_type: "confirmation", recipient_phone: opts.contactPhone,
      from_sender: opts.messagingServiceSid ? opts.practiceName : opts.twilioSmsNumber,
      body, status: res.ok ? "sent" : "failed", twilio_sid: result.sid || null,
    }).catch(() => {});
  } catch (err) { console.error("[CONFIRM SMS]", err); }
}

function sendConfirmationEmail(opts: { to: string; patientName: string; practiceName: string; serviceName: string; date: string; time: string; practitionerName?: string; patientInstructions?: string; practiceId: string; contactId?: string }) {
  fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: opts.to, type: "appointment_confirmation", practice_id: opts.practiceId, contact_id: opts.contactId,
      data: { patient_name: opts.patientName, service: opts.patientInstructions ? `${opts.serviceName}\n\n${opts.patientInstructions}` : opts.serviceName, date_time: `${formatDate(opts.date)} at ${opts.time}`, practitioner: opts.practitionerName || "" } }),
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// HANDLER: lookup_caller_phone (phone + web chat)
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleLookupCallerPhone(db: DB, args: any) {
  const { caller_phone, twilio_number, conversation_id, agent_id,
          practice_id: argPracticeId, contact_id: argContactId,
          visitor_name, visitor_phone, visitor_email, channel } = args;

  const isWebChat = channel === "web_chat" || !!visitor_name;
  const practice = await loadPractice(db, { practiceId: argPracticeId, twilioNumber: twilio_number, agentId: agent_id });
  if (!practice) return { success: false, message: "Practice not found." };

  const base = buildPracticeBase(practice);
  const lookupPhone = caller_phone || visitor_phone || null;

  if (!lookupPhone && !argContactId && !visitor_email) {
    return { ...base, found: false, message: `${base.current_datetime.summary}\nNo contact details available.` };
  }

  // Contact lookup
  let contact = null;
  if (argContactId) { const { data } = await db.from("contacts").select("id, name, phone, email, date_of_birth, address, postcode").eq("id", argContactId).single(); contact = data; }
  if (!contact && lookupPhone) contact = await findContactByPhone(db, practice.id, lookupPhone);
  if (!contact && visitor_email) { const { data } = await db.from("contacts").select("id, name, phone, email, date_of_birth, address, postcode").eq("practice_id", practice.id).eq("email", visitor_email).limit(1).single(); contact = data; }

  const normalised = lookupPhone ? normalizePhone(lookupPhone) : null;
  const source = isWebChat ? "chat" : "phone";
  const channelType = isWebChat ? "web_chat" : "phone";

  // Create contact for new callers
  if (!contact && normalised) {
    const { data: newContact } = await db.from("contacts").insert({ practice_id: practice.id, name: visitor_name || "New Patient", phone: normalised, source }).select("id, name, phone, email, date_of_birth, address, postcode").single();
    contact = newContact;
  }

  // Create enquiry + conversation + fetch history in parallel
  const enquiryRow = { practice_id: practice.id, patient_name: contact?.name || visitor_name || "Unknown Caller", phone_number: normalised, message: isWebChat ? "Web chat session" : "Incoming phone call", source, is_urgent: false, is_completed: false, contact_id: contact?.id || null };

  const [enquiryResult, convResult, history, lastApptResult] = await Promise.all([
    db.from("enquiries").insert(enquiryRow).select("id").single(),
    db.from("conversations").insert({ practice_id: practice.id, contact_id: contact?.id || null, elevenlabs_conversation_id: conversation_id || null, channel: channelType, status: "active", caller_name: contact?.name || visitor_name || null, caller_phone: normalised }).select("id").single(),
    getConversationHistory(db, { contactId: contact?.id, phone: normalised || undefined, practiceId: practice.id }),
    contact ? db.from("appointments").select("practitioners(name)").eq("contact_id", contact.id).eq("practice_id", practice.id).neq("status", "cancelled").order("starts_at", { ascending: false }).limit(1).single() : Promise.resolve({ data: null }),
  ]);

  const enquiryId = enquiryResult.data?.id || null;
  const convId = convResult.data?.id || null;
  const lastPractitioner = lastApptResult.data?.practitioners?.name || null;

  // Link conversation to enquiry (non-blocking)
  if (enquiryId && convId) db.from("conversations").update({ enquiry_id: enquiryId }).eq("id", convId).then(() => {});

  if (contact) {
    return { ...base, found: true, contact_id: contact.id, contact_name: contact.name, contact_phone: contact.phone, contact_email: contact.email, contact_dob: contact.date_of_birth, contact_address: contact.address, contact_postcode: contact.postcode, enquiry_id: enquiryId, conversation_db_id: convId, conversation_history: history, last_practitioner: lastPractitioner,
      message: `Account found. Patient name: ${contact.name}.${lastPractitioner ? ` Last seen by ${lastPractitioner}.` : ""}${history ? `\n\n${history}` : ""}` };
  }
  return { ...base, found: false, enquiry_id: enquiryId, conversation_db_id: convId, conversation_history: history,
    message: "No account linked to this number." + (history ? ` However, this number has contacted before:\n\n${history}` : "") };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER: lookup_account_phone
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleLookupAccountPhone(db: DB, args: any) {
  const { practice_id, account_phone } = args;
  if (!practice_id || !account_phone) return { success: false, message: "Missing practice ID or phone number." };

  const [contact, history] = await Promise.all([
    findContactByPhone(db, practice_id, account_phone),
    getConversationHistory(db, { phone: normalizePhone(account_phone), practiceId: practice_id }),
  ]);

  if (contact) return { success: true, found: true, contact_id: contact.id, contact_name: contact.name, contact_phone: contact.phone, contact_email: contact.email, contact_dob: contact.date_of_birth, contact_address: contact.address, contact_postcode: contact.postcode, conversation_history: history, message: `Account found. Patient name: ${contact.name}.${history ? `\n\n${history}` : ""}` };
  return { success: true, found: false, conversation_history: history, message: "No account found with that phone number." + (history ? ` But this number has interacted before:\n\n${history}` : "") };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER: verify_identity
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleVerifyIdentity(db: DB, args: any) {
  const { contact_id, stated_name, stated_dob } = args;
  if (!contact_id) return { success: false, message: "No contact to verify against." };

  const { data: contact } = await db.from("contacts").select("id, name, date_of_birth, address, postcode").eq("id", contact_id).single();
  if (!contact) return { success: false, message: "Contact not found." };

  const nameOnFile = (contact.name || "").toLowerCase().trim();
  const nameStated = (stated_name || "").toLowerCase().trim();

  /* Phone callers are created with a generic placeholder name ("New
     Patient") because caller ID gives us no name. The first time such a
     caller states their name, ADOPT it onto the contact record instead of
     mismatching against the placeholder. This is how the system learns the
     caller's name — so on the next call they're recognised by name, not
     just by number, and the dashboard shows a real name. */
  const GENERIC_NAMES = new Set(["new patient", "unknown", "new caller", "unknown caller", ""]);
  if (GENERIC_NAMES.has(nameOnFile) && nameStated) {
    await db.from("contacts").update({ name: stated_name }).eq("id", contact_id);
    if (!contact.date_of_birth && stated_dob) {
      await db.from("contacts").update({ date_of_birth: stated_dob }).eq("id", contact_id);
    }
    return { success: true, verified: true, name_adopted: true, contact_address: contact.address, contact_postcode: contact.postcode, message: `Thanks ${stated_name}, I've got your details. Identity verified.` };
  }

  let nameMatch = nameOnFile === nameStated || nameOnFile.includes(nameStated) || nameStated.includes(nameOnFile);
  if (!nameMatch) {
    const fileParts = nameOnFile.split(/[\s\-]+/).filter(Boolean);
    const statedParts = nameStated.split(/[\s\-]+/).filter(Boolean);
    const matchingParts = fileParts.filter(fp => statedParts.some(sp => sp === fp || (fp.length > 3 && sp.length > 3 && levenshtein(fp, sp) <= 2)));
    nameMatch = matchingParts.length >= Math.ceil(Math.max(fileParts.length, statedParts.length) / 2) && matchingParts.length >= 1;
  }
  if (!nameMatch) return { success: true, verified: false, reason: "name_mismatch", message: "The name doesn't match what we have on file." };

  if (!contact.date_of_birth) {
    await db.from("contacts").update({ date_of_birth: stated_dob }).eq("id", contact_id);
    return { success: true, verified: true, dob_was_missing: true, contact_address: contact.address, contact_postcode: contact.postcode, message: "Name matches. Date of birth recorded. Identity verified." };
  }
  if (contact.date_of_birth !== stated_dob) return { success: true, verified: false, reason: "dob_mismatch", message: "The date of birth doesn't match what we have on file." };
  return { success: true, verified: true, contact_address: contact.address, contact_postcode: contact.postcode, message: "Identity verified successfully." };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER: update_address
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleUpdateAddress(db: DB, args: any) {
  const { contact_id, new_address, new_postcode } = args;
  if (!contact_id || !new_address) return { success: false, message: "Missing contact ID or address." };
  // deno-lint-ignore no-explicit-any
  const updates: any = { address: new_address };
  if (new_postcode) updates.postcode = new_postcode;
  const { error } = await db.from("contacts").update(updates).eq("id", contact_id);
  if (error) return { success: false, message: "Failed to update address." };
  return { success: true, message: "Address updated successfully." };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER: search_availability
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleSearchAvailability(db: DB, args: any) {
  let { practice_id, agent_id, service_name, preference_day, preference_time, preference_date, is_urgent, contact_id } = args;
  if (!service_name) return { success: false, message: "Missing service name." };

  // Resolve practice by agent_id (system var on phone calls) if the LLM
  // didn't carry practice_id forward from the lookup result.
  if (!practice_id && agent_id) { const p = await loadPractice(db, { agentId: agent_id }); practice_id = p?.id; }
  if (!practice_id) { const p = await loadPractice(db, {}); practice_id = p?.id; }
  if (!practice_id) return { success: false, message: "Practice not found." };

  // Practice hours + service match in parallel
  const [practiceResult, serviceResult] = await Promise.all([
    db.from("practices").select("opening_hours, holiday_hours").eq("id", practice_id).single(),
    db.from("services").select("id, name, duration_minutes, buffer_minutes, price_pence, notes").eq("practice_id", practice_id).ilike("name", `%${service_name}%`).limit(1),
  ]);

  const practice = practiceResult.data;
  if (!practice) return { success: false, message: "Practice not found." };

  if (!serviceResult.data || serviceResult.data.length === 0) {
    const { data: allServices } = await db.from("services").select("name").eq("practice_id", practice_id).order("name");
    const serviceNames = (allServices || []).map((s: { name: string }) => s.name);
    const hasConsultation = serviceNames.some((n: string) => /consult|check-up|examination/i.test(n));
    return { success: true, slots: [], service_not_found: true, requested_service: service_name, available_services: serviceNames,
      message: `We don't currently offer "${service_name}". Available treatments: ${serviceNames.join(", ")}.${hasConsultation ? " I can book you a consultation to discuss your options." : ""}` };
  }

  const service = serviceResult.data[0];
  const totalMinutes = (service.duration_minutes || 30) + (service.buffer_minutes || 0);

  // Practitioner links + last practitioner in parallel
  const [linksResult, lastApptResult] = await Promise.all([
    db.from("practitioner_services").select("practitioner_id").eq("service_id", service.id),
    contact_id ? db.from("appointments").select("practitioner_id, practitioners(name)").eq("contact_id", contact_id).eq("practice_id", practice_id).neq("status", "cancelled").order("starts_at", { ascending: false }).limit(1).single() : Promise.resolve({ data: null }),
  ]);

  const practitionerIds = (linksResult.data || []).map((l: { practitioner_id: string }) => l.practitioner_id);
  let practitioners;
  if (practitionerIds.length > 0) {
    const { data } = await db.from("practitioners").select("id, name, working_hours, bio, credentials, sort_order").in("id", practitionerIds).order("sort_order", { ascending: true });
    practitioners = data || [];
  } else {
    // No mapping — default to most senior practitioner
    const { data } = await db.from("practitioners").select("id, name, working_hours, bio, credentials, sort_order").eq("practice_id", practice_id).order("sort_order", { ascending: true }).limit(1);
    practitioners = data || [];
  }

  if (practitioners.length === 0) return { success: true, slots: [], service_id: service.id, message: "No practitioners available for this service." };

  let slots = await findSlots(db, { practitioners, practice_id, service, totalMinutes, preference_day, preference_time, preference_date, openingHours: practice.opening_hours || [], holidayHours: practice.holiday_hours || [], searchDays: is_urgent ? 3 : 14 });
  if (is_urgent && slots.length === 0) slots = await findSlots(db, { practitioners, practice_id, service, totalMinutes, preference_day, preference_time, preference_date, openingHours: practice.opening_hours || [], holidayHours: practice.holiday_hours || [], searchDays: 5 });

  // Rank: prefer last practitioner, then soonest
  const lastPracId = lastApptResult.data?.practitioner_id || null;
  const lastPracName = lastApptResult.data?.practitioners?.name || null;
  // deno-lint-ignore no-explicit-any
  const scored = slots.map((s: any, i: number) => ({ ...s, _score: (s.practitioner_id === lastPracId ? 0 : 1000) + i, _pref: s.practitioner_id === lastPracId }));
  scored.sort((a: { _score: number }, b: { _score: number }) => a._score - b._score);
  const ranked = scored.slice(0, 6);

  let recommended = null, recommendReason = "";
  if (ranked.length > 0) {
    recommended = ranked[0];
    recommendReason = recommended._pref ? `${lastPracName || recommended.practitioner_name} saw you last time — I'd suggest booking with them again.` : `${recommended.practitioner_name} has the earliest availability.`;
  }

  // deno-lint-ignore no-explicit-any
  const cleanSlots = ranked.map((s: any) => ({ practitioner_id: s.practitioner_id, practitioner_name: s.practitioner_name, date: s.date, start_time: s.start_time, end_time: s.end_time, display: s.display }));

  return { success: true, slots: cleanSlots,
    recommended_slot: recommended ? { display: recommended.display, practitioner_name: recommended.practitioner_name, date: recommended.date, start_time: recommended.start_time, reason: recommendReason } : null,
    service_id: service.id, service_name: service.name,
    service_price: service.price_pence ? `£${(service.price_pence / 100).toFixed(2)}` : null,
    service_duration: `${service.duration_minutes || 30} minutes`,
    message: slots.length === 0 ? "No available slots found." : recommended ? `I'd recommend ${recommended.display}. ${recommendReason}` : `Found ${slots.length} slot(s).` };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER: request_appointment
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleRequestAppointment(db: DB, args: any) {
  let { practice_id, agent_id, contact_id, service_id, chosen_slot, is_urgent = false, notes, enquiry_id,
        slot_practitioner_id, slot_date, slot_start_time, slot_end_time, slot_practitioner_name } = args;

  // Accept flat slot fields
  if (slot_date && slot_start_time && (!chosen_slot || !chosen_slot.date)) {
    chosen_slot = { practitioner_id: slot_practitioner_id || null, date: slot_date, start_time: slot_start_time, end_time: slot_end_time || slot_start_time, practitioner_name: slot_practitioner_name || null };
  }

  // Resolve practice by agent_id (system var on phone calls) if needed.
  if (!practice_id && agent_id) { const p = await loadPractice(db, { agentId: agent_id }); practice_id = p?.id; }
  if (!practice_id) { const p = await loadPractice(db, {}); practice_id = p?.id; }
  if (!practice_id) return { success: false, message: "Practice not found." };

  // Resolve contact_id from enquiry, or enquiry_id from contact
  if (!contact_id && enquiry_id) {
    const { data: enq } = await db.from("enquiries").select("contact_id").eq("id", enquiry_id).single();
    if (enq?.contact_id) contact_id = enq.contact_id;
  }
  if (!enquiry_id && contact_id && practice_id) {
    // Find the most recent open enquiry for this contact (created in lookup_caller_phone)
    const { data: recentEnq } = await db.from("enquiries").select("id")
      .eq("contact_id", contact_id).eq("practice_id", practice_id).eq("is_completed", false)
      .order("created_at", { ascending: false }).limit(1).single();
    if (recentEnq) enquiry_id = recentEnq.id;
  }
  if (!enquiry_id && practice_id) {
    // Last resort: find the most recent open enquiry for this practice (within last 10 min)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentEnq } = await db.from("enquiries").select("id, contact_id")
      .eq("practice_id", practice_id).eq("is_completed", false)
      .gte("created_at", tenMinAgo)
      .order("created_at", { ascending: false }).limit(1).single();
    if (recentEnq) {
      enquiry_id = recentEnq.id;
      if (!contact_id && recentEnq.contact_id) contact_id = recentEnq.contact_id;
    }
  }

  // Fetch all needed data in parallel
  const [practiceResult, serviceResult, contactResult] = await Promise.all([
    db.from("practices").select("name, opening_hours, holiday_hours, messaging_service_sid, twilio_sms_number, integrations").eq("id", practice_id).single(),
    service_id ? db.from("services").select("name, patient_instructions").eq("id", service_id).single() : Promise.resolve({ data: null }),
    contact_id ? db.from("contacts").select("phone, email, name").eq("id", contact_id).single() : Promise.resolve({ data: null }),
  ]);

  const practice = practiceResult.data;
  const serviceData = serviceResult.data;
  const contactData = contactResult.data;
  const hoursStatus = practice ? getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours) : { is_open_now: false };
  const outsideHours = !hoursStatus.is_open_now;
  const serviceName = serviceData?.name || "Appointment";

  let slot = chosen_slot;
  if (typeof slot === "string") { try { slot = JSON.parse(slot); } catch { slot = null; } }
  const hasSlot = slot && slot.date && slot.start_time;
  const status = hasSlot ? "confirmed" : (is_urgent ? "asap" : "pending");
  const requestNotes = [notes || "", outsideHours ? "[Submitted outside practice hours]" : ""].filter(Boolean).join(" ").trim() || null;

  // Insert appointment request
  const { data: request, error } = await db.from("appointment_requests").insert({
    practice_id, contact_id: contact_id || null, service_id: service_id || null, is_urgent, status,
    confirmed_at: hasSlot ? new Date().toISOString() : null, chosen_slot: slot || null,
    preferred_date: slot?.date || null, preferred_time: slot?.start_time || null,
    preferred_practitioner_id: slot?.practitioner_id || null, notes: requestNotes,
    submitted_outside_hours: outsideHours, source: "phone",
  }).select().single();

  if (error) return { success: false, message: "Failed to create appointment request." };

  // Conflict check + insert appointment
  if (hasSlot) {
    const slotStart = `${slot.date}T${slot.start_time}:00`, slotEnd = `${slot.date}T${slot.end_time || slot.start_time}:00`;
    let hasConflict = false;
    if (slot.practitioner_id) {
      const { data: conflicts } = await db.from("appointments").select("id").eq("practitioner_id", slot.practitioner_id).neq("status", "cancelled").lt("starts_at", slotEnd).gt("ends_at", slotStart).limit(1);
      hasConflict = (conflicts || []).length > 0;
    }
    if (hasConflict) {
      await db.from("appointment_requests").update({ status: "pending", confirmed_at: null }).eq("id", request.id);
      return { success: true, request_id: request.id, status: "pending", enquiry_id, message: "That slot was just taken. Let me find the next available slot — would you like me to check?" };
    }
    await db.from("appointments").insert({ practice_id, practitioner_id: slot.practitioner_id || null, service_id: service_id || null, contact_id: contact_id || null, starts_at: slotStart, ends_at: slotEnd, status: "confirmed", source: "phone", notes: requestNotes });
  }

  // All post-booking side effects in parallel
  const sideEffects: Promise<unknown>[] = [];
  if (enquiry_id) {
    sideEffects.push(db.from("enquiries").update({ selected_service: serviceName, appointment_status: hasSlot ? "confirmed" : "pending", appointment_request_id: request.id, message: `Appointment request: ${serviceName} — ${slot ? `${slot.date} at ${slot.start_time}` : "ASAP"}`, ...(slot?.date ? { appointment_datetime: `${slot.date}T${slot.start_time}:00` } : {}) }).eq("id", enquiry_id));
    sideEffects.push(db.from("conversations").update({ outcome: "booking_made" }).eq("enquiry_id", enquiry_id));
  }
  if (hasSlot && contactData?.phone && practice) {
    sideEffects.push(sendConfirmationSms(db, { contactPhone: contactData.phone, practiceName: practice.name, serviceName, date: slot.date, time: slot.start_time, practitionerName: slot.practitioner_name || null, messagingServiceSid: practice.messaging_service_sid, twilioSmsNumber: practice.twilio_sms_number, smsEnabled: practice.integrations?.sms_enabled !== false, practiceId: practice_id, contactId: contact_id, enquiryId: enquiry_id }).catch(() => {}));
  }
  if (hasSlot && contactData?.email && practice) {
    sendConfirmationEmail({ to: contactData.email, patientName: contactData.name || "Patient", practiceName: practice.name, serviceName, date: slot.date, time: slot.start_time, practitionerName: slot.practitioner_name || null, patientInstructions: serviceData?.patient_instructions || undefined, practiceId: practice_id, contactId: contact_id });
  }
  await Promise.all(sideEffects);

  let message;
  if (hasSlot) message = "That's all booked in for you. You'll receive a confirmation shortly.";
  else if (status === "asap") message = outsideHours ? "I've put in an urgent request. The practice is currently closed but this has been flagged and you'll hear back as soon as we open." : "I've put in an urgent request. This has been flagged and you'll hear back very shortly.";
  else message = "I've pencilled that in. You'll receive a confirmation text shortly.";

  return { success: true, request_id: request.id, status, submitted_outside_hours: outsideHours, enquiry_id, message };
}

// ═══════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const toolName = url.searchParams.get("tool");
    if (!toolName) return new Response(JSON.stringify({ success: false, message: "Missing ?tool= parameter" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const args = await req.json();
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // deno-lint-ignore no-explicit-any
    let result: any;
    try {
      switch (toolName) {
        case "lookup_caller_phone": result = await handleLookupCallerPhone(db, args); break;
        case "lookup_account_phone": result = await handleLookupAccountPhone(db, args); break;
        case "lookup_web_visitor": result = await handleLookupCallerPhone(db, { ...args, channel: "web_chat" }); break;
        case "verify_identity": result = await handleVerifyIdentity(db, args); break;
        case "update_address": result = await handleUpdateAddress(db, args); break;
        case "search_availability": result = await handleSearchAvailability(db, args); break;
        case "request_appointment": result = await handleRequestAppointment(db, args); break;
        default: result = { success: false, message: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[ELEVENLABS TOOL] ${toolName}:`, err);
      result = { success: false, message: "I'm having a temporary technical issue. Let me try a different way to help you — could you repeat what you need?" };
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[ELEVENLABS TOOL ERROR]", err);
    return new Response(JSON.stringify({ success: false, message: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
