/**
 * Purpose:
 *   ElevenLabs mid-call tool handler — single endpoint for all 6 tools.
 *   Called by ElevenLabs agent via webhook: POST ?tool=<tool_name>
 *   Receives plain JSON body, returns plain JSON response.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/cors.ts
 *
 * Used by:
 *   - ElevenLabs agent tools (webhook URLs)
 *
 * Changes:
 *   2026-03-10: Initial creation — full booking + identity flow
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Normalize a UK phone number to E.164 format (+44...) */
function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, "").trim();
  if (p.startsWith("0") && p.length >= 10) p = "+44" + p.slice(1);
  if (p.match(/^44\d{9,}$/) && !p.startsWith("+")) p = "+" + p;
  return p;
}

// ---------------------------------------------------------------------------
// Practice hours (Europe/London timezone-aware)
// ---------------------------------------------------------------------------

function getPracticeHoursStatus(
  openingHours: Array<{ day: string; is_open: boolean; open_time: string; close_time: string }>,
  holidayHours: Array<{ date: string; is_open: boolean; open_time?: string; close_time?: string; label?: string }>,
) {
  const now = new Date();
  const londonFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = londonFormatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
  const currentMinutes = hour * 60 + minute;

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateParts = dateFormatter.formatToParts(now);
  const dd = dateParts.find((p) => p.type === "day")?.value || "";
  const mm = dateParts.find((p) => p.type === "month")?.value || "";
  const yyyy = dateParts.find((p) => p.type === "year")?.value || "";
  const todayISO = `${yyyy}-${mm}-${dd}`;

  // Check holiday override
  const holiday = (holidayHours || []).find((h) => h.date === todayISO);
  if (holiday) {
    if (!holiday.is_open) {
      return {
        is_open_now: false,
        current_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        today_hours: null,
        is_holiday: true,
        holiday_label: holiday.label || "Holiday",
        next_open: findNextOpen(openingHours, holidayHours, todayISO),
      };
    }
    // Holiday but open with custom hours
    const hOpen = timeToMinutes(holiday.open_time || "09:00");
    const hClose = timeToMinutes(holiday.close_time || "17:00");
    const isOpen = currentMinutes >= hOpen && currentMinutes < hClose;
    return {
      is_open_now: isOpen,
      current_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      today_hours: { open_time: holiday.open_time, close_time: holiday.close_time },
      closes_in_minutes: isOpen ? hClose - currentMinutes : 0,
      closing_soon: isOpen && hClose - currentMinutes <= 30,
      is_holiday: true,
      holiday_label: holiday.label || "Holiday hours",
      next_open: isOpen ? null : findNextOpen(openingHours, holidayHours, todayISO),
    };
  }

  // Regular hours
  const todayHours = (openingHours || []).find(
    (h) => h.day.toLowerCase() === weekday.toLowerCase(),
  );
  if (!todayHours || !todayHours.is_open) {
    return {
      is_open_now: false,
      current_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      today_hours: null,
      next_open: findNextOpen(openingHours, holidayHours, todayISO),
    };
  }

  const openMin = timeToMinutes(todayHours.open_time);
  const closeMin = timeToMinutes(todayHours.close_time);
  const isOpen = currentMinutes >= openMin && currentMinutes < closeMin;

  return {
    is_open_now: isOpen,
    current_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    today_hours: { open_time: todayHours.open_time, close_time: todayHours.close_time },
    closes_in_minutes: isOpen ? closeMin - currentMinutes : 0,
    closing_soon: isOpen && closeMin - currentMinutes <= 30,
    next_open: isOpen ? null : findNextOpen(openingHours, holidayHours, todayISO),
  };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function findNextOpen(
  openingHours: Array<{ day: string; is_open: boolean; open_time: string }>,
  holidayHours: Array<{ date: string; is_open: boolean }>,
  fromISO: string,
) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const from = new Date(fromISO + "T12:00:00Z");
  for (let i = 1; i <= 7; i++) {
    const next = new Date(from.getTime() + i * 86400000);
    const iso = next.toISOString().slice(0, 10);
    const holiday = (holidayHours || []).find((h) => h.date === iso);
    if (holiday && !holiday.is_open) continue;
    const dayName = days[next.getUTCDay()];
    const hours = (openingHours || []).find((h) => h.day === dayName);
    if (hours && hours.is_open) {
      return { day: dayName, date: iso, open_time: hours.open_time };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contact lookup
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function findContactByPhone(db: any, practiceId: string, phone: string) {
  const normalised = normalizePhone(phone);
  const cols = "id, name, phone, email, date_of_birth, address, postcode";

  // Exact
  const { data: c1 } = await db
    .from("contacts").select(cols)
    .eq("practice_id", practiceId).eq("phone", phone)
    .limit(1).single();
  if (c1) return c1;

  // Normalised
  if (normalised !== phone) {
    const { data: c2 } = await db
      .from("contacts").select(cols)
      .eq("practice_id", practiceId).eq("phone", normalised)
      .limit(1).single();
    if (c2) return c2;
  }

  // +44 ↔ 0
  const alt = phone.startsWith("+44")
    ? "0" + phone.slice(3)
    : phone.startsWith("0")
      ? "+44" + phone.slice(1)
      : null;
  if (alt) {
    const { data: c3 } = await db
      .from("contacts").select(cols)
      .eq("practice_id", practiceId).eq("phone", alt)
      .limit(1).single();
    if (c3) return c3;
  }
  return null;
}

// ---------------------------------------------------------------------------
// RAG — fetch recent conversation history for a contact or phone number
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary of past conversations for the agent.
 * Searches by contact_id (known patient) first, then by caller_phone
 * (unknown but recurring). Returns the 5 most recent interactions.
 */
// deno-lint-ignore no-explicit-any
async function getConversationHistory(db: any, opts: { contactId?: string; phone?: string; practiceId: string }) {
  const { contactId, phone, practiceId } = opts;

  let conversations = null;

  // Path 1: known patient — search by contact_id (fast, indexed)
  if (contactId) {
    const { data } = await db
      .from("conversations")
      .select("channel, status, outcome, summary, caller_name, started_at, duration_seconds")
      .eq("contact_id", contactId)
      .eq("practice_id", practiceId)
      .order("started_at", { ascending: false })
      .limit(5);
    conversations = data;
  }

  // Path 2: unknown caller — search by phone number (still indexed)
  if ((!conversations || conversations.length === 0) && phone) {
    const normalised = normalizePhone(phone);
    const { data } = await db
      .from("conversations")
      .select("channel, status, outcome, summary, caller_name, started_at, duration_seconds")
      .eq("caller_phone", normalised)
      .eq("practice_id", practiceId)
      .order("started_at", { ascending: false })
      .limit(5);
    conversations = data;
  }

  if (!conversations || conversations.length === 0) return null;

  // Format into a concise context string the agent can use naturally
  const channelLabel: Record<string, string> = {
    phone: "Phone call", web_chat: "Web chat", sms: "Text message",
  };
  const lines = conversations.map((c: {
    channel: string; outcome: string; summary: string;
    started_at: string; duration_seconds: number; caller_name: string;
  }) => {
    const date = new Date(c.started_at).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short",
    });
    const via = channelLabel[c.channel] || c.channel;
    const outcomeStr = c.outcome ? ` → ${c.outcome.replace(/_/g, " ")}` : "";
    return `- ${date} (${via}): ${c.summary || "No summary"}${outcomeStr}`;
  });

  return "Previous interactions:\n" + lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function handleLookupCallerPhone(db: any, args: any) {
  const { caller_phone, twilio_number, conversation_id } = args;
  if (!twilio_number) return { success: false, message: "No practice number detected." };

  const { data: practice } = await db
    .from("practices").select("id, name, email, opening_hours, holiday_hours, integrations")
    .eq("twilio_phone_number", twilio_number).single();
  if (!practice) return { success: false, message: "Practice not found." };

  const practiceHours = getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours);
  const integrations = practice.integrations || {};
  const base = {
    success: true, practice_id: practice.id, practice_name: practice.name,
    practice_email: practice.email || integrations.email_from || null,
    practice_hours: practiceHours,
    email_enabled: !!integrations.email_enabled,
    stripe_connected: !!integrations.stripe_connected,
  };

  if (!caller_phone) return { ...base, found: false, message: "No caller phone number available." };

  const contact = await findContactByPhone(db, practice.id, caller_phone);

  // Create an enquiry for every inbound call so it appears in the dashboard
  const normalised = normalizePhone(caller_phone);
  const enquiryRow = {
    practice_id: practice.id,
    patient_name: contact?.name || "Unknown Caller",
    phone_number: normalised,
    message: "Incoming phone call",
    source: "phone",
    is_urgent: false,
    is_completed: false,
    contact_id: contact?.id || null,
  };
  const { data: enquiry } = await db
    .from("enquiries").insert(enquiryRow).select("id").single();
  const enquiryId = enquiry?.id || null;

  // Create a conversation record for this session
  const convRow = {
    practice_id: practice.id,
    contact_id: contact?.id || null,
    elevenlabs_conversation_id: conversation_id || null,
    channel: "phone",
    status: "active",
    caller_name: contact?.name || null,
    caller_phone: normalised,
    enquiry_id: enquiryId,
  };
  const { data: conv } = await db
    .from("conversations").insert(convRow).select("id").single();

  // Fetch RAG context — past conversations for this patient/number
  const history = await getConversationHistory(db, {
    contactId: contact?.id, phone: normalised, practiceId: practice.id,
  });

  if (contact) {
    return {
      ...base, found: true, contact_id: contact.id, contact_name: contact.name,
      contact_phone: contact.phone, contact_email: contact.email,
      contact_dob: contact.date_of_birth, contact_address: contact.address,
      contact_postcode: contact.postcode, enquiry_id: enquiryId,
      conversation_db_id: conv?.id || null,
      conversation_history: history,
      message: `Account found for this phone number. Patient name on file: ${contact.name}.`
        + (history ? `\n\n${history}` : ""),
    };
  }
  return {
    ...base, found: false, enquiry_id: enquiryId,
    conversation_db_id: conv?.id || null,
    conversation_history: history,
    message: "No account linked to this phone number."
      + (history ? ` However, this number has called before:\n\n${history}` : ""),
  };
}

// deno-lint-ignore no-explicit-any
async function handleLookupAccountPhone(db: any, args: any) {
  const { practice_id, account_phone } = args;
  if (!practice_id || !account_phone) return { success: false, message: "Missing practice ID or phone number." };

  const contact = await findContactByPhone(db, practice_id, account_phone);

  // Fetch RAG context for the looked-up number
  const history = await getConversationHistory(db, {
    contactId: contact?.id,
    phone: normalizePhone(account_phone),
    practiceId: practice_id,
  });

  if (contact) {
    return {
      success: true, found: true, contact_id: contact.id, contact_name: contact.name,
      contact_phone: contact.phone, contact_email: contact.email,
      contact_dob: contact.date_of_birth, contact_address: contact.address,
      contact_postcode: contact.postcode,
      conversation_history: history,
      message: `Account found. Patient name on file: ${contact.name}.`
        + (history ? `\n\n${history}` : ""),
    };
  }
  return {
    success: true, found: false,
    conversation_history: history,
    message: "No account found with that phone number."
      + (history ? ` But this number has interacted before:\n\n${history}` : ""),
  };
}

// deno-lint-ignore no-explicit-any
async function handleVerifyIdentity(db: any, args: any) {
  const { contact_id, stated_name, stated_dob } = args;
  if (!contact_id) return { success: false, message: "No contact to verify against." };

  const { data: contact } = await db
    .from("contacts").select("id, name, date_of_birth, address, postcode")
    .eq("id", contact_id).single();
  if (!contact) return { success: false, message: "Contact not found." };

  const nameOnFile = (contact.name || "").toLowerCase().trim();
  const nameStated = (stated_name || "").toLowerCase().trim();

  // Fuzzy name matching: exact, substring, or compare individual parts
  let nameMatch = nameOnFile === nameStated || nameOnFile.includes(nameStated) || nameStated.includes(nameOnFile);
  if (!nameMatch) {
    // Split into parts and check if surname matches + first name is close
    const fileParts = nameOnFile.split(/[\s\-]+/).filter(Boolean);
    const statedParts = nameStated.split(/[\s\-]+/).filter(Boolean);
    // Count how many parts match (handles "johannes" vs "johannis")
    const matchingParts = fileParts.filter((fp) =>
      statedParts.some((sp) => sp === fp || (fp.length > 3 && sp.length > 3 && levenshtein(fp, sp) <= 2))
    );
    // If at least half the name parts match (and at least 1), accept it
    nameMatch = matchingParts.length >= Math.ceil(Math.max(fileParts.length, statedParts.length) / 2) && matchingParts.length >= 1;
  }

  if (!nameMatch) return { success: true, verified: false, reason: "name_mismatch", message: "The name doesn't match what we have on file." };

  const dobOnFile = contact.date_of_birth;
  if (!dobOnFile) {
    await db.from("contacts").update({ date_of_birth: stated_dob }).eq("id", contact_id);
    return { success: true, verified: true, dob_was_missing: true, contact_address: contact.address, contact_postcode: contact.postcode, message: "Name matches. Date of birth recorded. Identity verified." };
  }

  const dobMatch = dobOnFile && stated_dob && dobOnFile === stated_dob;
  if (!dobMatch) return { success: true, verified: false, reason: "dob_mismatch", message: "The date of birth doesn't match what we have on file." };

  return { success: true, verified: true, contact_address: contact.address, contact_postcode: contact.postcode, message: "Identity verified successfully." };
}

// deno-lint-ignore no-explicit-any
async function handleUpdateAddress(db: any, args: any) {
  const { contact_id, new_address, new_postcode } = args;
  if (!contact_id || !new_address) return { success: false, message: "Missing contact ID or address." };

  // deno-lint-ignore no-explicit-any
  const updates: any = { address: new_address };
  if (new_postcode) updates.postcode = new_postcode;

  const { error } = await db.from("contacts").update(updates).eq("id", contact_id);
  if (error) { console.error("[UPDATE ADDRESS]", error); return { success: false, message: "Failed to update address." }; }
  return { success: true, message: "Address updated successfully." };
}

// deno-lint-ignore no-explicit-any
async function handleSearchAvailability(db: any, args: any) {
  const { practice_id, service_name, preference_day, preference_time, preference_date, is_urgent } = args;
  if (!practice_id || !service_name) return { success: false, message: "Missing practice ID or service name." };

  const { data: practice } = await db.from("practices").select("opening_hours, holiday_hours").eq("id", practice_id).single();
  if (!practice) return { success: false, message: "Practice not found." };

  // Find matching service
  const { data: services } = await db
    .from("services").select("id, name, duration_minutes, buffer_minutes")
    .eq("practice_id", practice_id).ilike("name", `%${service_name}%`).limit(1);

  if (!services || services.length === 0) {
    return { success: true, slots: [], message: `No service matching "${service_name}" found. Available services can be checked with the practice.` };
  }
  const service = services[0];
  const totalMinutes = (service.duration_minutes || 30) + (service.buffer_minutes || 0);

  // Find practitioners who offer this service
  const { data: practitionerLinks } = await db
    .from("practitioner_services").select("practitioner_id").eq("service_id", service.id);

  const practitionerIds = (practitionerLinks || []).map((l: { practitioner_id: string }) => l.practitioner_id);

  let practitioners;
  if (practitionerIds.length > 0) {
    const { data } = await db.from("practitioners").select("id, name, working_hours").in("id", practitionerIds);
    practitioners = data || [];
  } else {
    // Fallback: all practitioners at the practice
    const { data } = await db.from("practitioners").select("id, name, working_hours").eq("practice_id", practice_id);
    practitioners = data || [];
  }

  if (practitioners.length === 0) {
    return { success: true, slots: [], service_id: service.id, message: "No practitioners available for this service." };
  }

  // Search for slots
  const searchDays = is_urgent ? 3 : 14;
  const slots = await findSlots(db, {
    practitioners, practice_id, service, totalMinutes,
    preference_day, preference_time, preference_date,
    openingHours: practice.opening_hours || [],
    holidayHours: practice.holiday_hours || [],
    searchDays,
  });

  // Urgent: expand to 5 days if nothing found
  if (is_urgent && slots.length === 0) {
    const expanded = await findSlots(db, {
      practitioners, practice_id, service, totalMinutes,
      preference_day, preference_time, preference_date,
      openingHours: practice.opening_hours || [],
      holidayHours: practice.holiday_hours || [],
      searchDays: 5,
    });
    if (expanded.length > 0) {
      const hoursStatus = getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours);
      return { success: true, slots: expanded.slice(0, 6), service_id: service.id, service_name: service.name, expanded_search: true, practice_hours: hoursStatus };
    }
  }

  const hoursStatus = getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours);
  return {
    success: true,
    slots: slots.slice(0, 6),
    service_id: service.id,
    service_name: service.name,
    practice_hours: hoursStatus,
    message: slots.length === 0 ? "No available slots found for the requested criteria." : `Found ${slots.length} available slot(s).`,
  };
}

// deno-lint-ignore no-explicit-any
async function findSlots(db: any, opts: any) {
  const { practitioners, practice_id, totalMinutes, preference_day, preference_time, preference_date, openingHours, holidayHours, searchDays } = opts;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // deno-lint-ignore no-explicit-any
  const slots: any[] = [];
  const today = new Date();

  for (let d = 1; d <= searchDays; d++) {
    const date = new Date(today.getTime() + d * 86400000);
    const iso = date.toISOString().slice(0, 10);
    const dayName = days[date.getUTCDay()];

    // Specific date filter
    if (preference_date && iso !== preference_date) continue;

    // Day preference filter
    if (preference_day && dayName.toLowerCase() !== preference_day.toLowerCase()) continue;

    // Check if practice is open this day
    const holiday = (holidayHours || []).find((h: { date: string }) => h.date === iso);
    if (holiday && !holiday.is_open) continue;
    const dayHours = (openingHours || []).find((h: { day: string }) => h.day === dayName);
    if (!dayHours || !dayHours.is_open) continue;

    // Get existing appointments for this day
    const { data: existing } = await db
      .from("appointments").select("practitioner_id, starts_at, ends_at")
      .eq("practice_id", practice_id)
      .gte("starts_at", `${iso}T00:00:00`)
      .lt("starts_at", `${iso}T23:59:59`)
      .in("status", ["confirmed", "pending"]);

    for (const prac of practitioners) {
      // working_hours can be an array [{day, is_working, start_time, end_time}] or {} (empty/unset)
      const whArr = Array.isArray(prac.working_hours) ? prac.working_hours : [];
      const wh = whArr.find((w: { day: string }) => w.day === dayName);

      // If practitioner has no working_hours set, assume they follow practice hours
      if (whArr.length > 0 && (!wh || !wh.is_working)) continue;

      const startMin = timeToMinutes(wh?.start_time || dayHours.open_time);
      const endMin = timeToMinutes(wh?.end_time || dayHours.close_time);

      // Build blocked windows for this practitioner
      const blocked = (existing || [])
        .filter((a: { practitioner_id: string }) => a.practitioner_id === prac.id)
        .map((a: { starts_at: string; ends_at: string }) => ({
          start: timeToMinutes(a.starts_at.slice(11, 16)),
          end: timeToMinutes(a.ends_at.slice(11, 16)),
        }));

      // Generate 15-min interval slots
      for (let t = startMin; t + totalMinutes <= endMin; t += 15) {
        const slotEnd = t + totalMinutes;
        const overlaps = blocked.some((b: { start: number; end: number }) => t < b.end && slotEnd > b.start);
        if (overlaps) continue;

        // Time preference filter
        if (preference_time) {
          if (preference_time === "morning" && t >= 720) continue; // 12:00
          if (preference_time === "afternoon" && t < 720) continue;
          if (preference_time.includes(":")) {
            const prefMin = timeToMinutes(preference_time);
            if (Math.abs(t - prefMin) > 120) continue; // ±2hr window
          }
        }

        const startTime = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        const endTime = `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`;

        slots.push({
          practitioner_id: prac.id,
          practitioner_name: prac.name,
          date: iso,
          day: dayName,
          start_time: startTime,
          end_time: endTime,
          display: `${dayName} the ${ordinal(date.getUTCDate())} at ${startTime} with ${prac.name.split(" ")[0]}`,
        });
      }
    }
  }
  return slots;
}

/** Simple Levenshtein distance for fuzzy name matching */
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// deno-lint-ignore no-explicit-any
async function handleRequestAppointment(db: any, args: any) {
  const { practice_id, contact_id, service_id, chosen_slot, is_urgent = false, notes, enquiry_id } = args;
  if (!practice_id) return { success: false, message: "Missing practice ID." };

  const { data: practice } = await db.from("practices").select("opening_hours, holiday_hours").eq("id", practice_id).single();
  const hoursStatus = practice ? getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours) : { is_open_now: false };
  const outsideHours = !hoursStatus.is_open_now;

  // Parse chosen_slot if it's a string
  let slot = chosen_slot;
  if (typeof slot === "string") {
    try { slot = JSON.parse(slot); } catch { slot = null; }
  }

  const status = is_urgent && !slot ? "asap" : "pending";
  const requestNotes = [notes || "", outsideHours ? "[Submitted outside practice hours]" : ""].filter(Boolean).join(" ").trim() || null;

  const { data: request, error } = await db.from("appointment_requests").insert({
    practice_id,
    contact_id: contact_id || null,
    service_id: service_id || null,
    is_urgent,
    status,
    chosen_slot: slot || null,
    preferred_date: slot?.date || null,
    preferred_time: slot?.start_time || null,
    notes: requestNotes,
    submitted_outside_hours: outsideHours,
    source: "phone",
  }).select().single();

  if (error) { console.error("[REQUEST APPOINTMENT]", error); return { success: false, message: "Failed to create appointment request." }; }

  /* Link the booking back to the enquiry so the dashboard shows it.
     The dashboard reads selected_service, appointment_datetime, and
     appointment_status to render the appointment card. Status starts
     as 'pending' (yellow) — turns 'confirmed' (green) when the practice
     confirms it in the diary. Do NOT set is_completed here. */
  if (enquiry_id) {
    let serviceName = "Appointment";
    if (service_id) {
      const { data: svc } = await db.from("services").select("name").eq("id", service_id).single();
      if (svc) serviceName = svc.name;
    }

    const enquiryUpdate: Record<string, unknown> = {
      selected_service: serviceName,
      appointment_status: "pending",
      appointment_request_id: request.id,
      message: `Appointment request: ${serviceName} — ${slot ? `${slot.date} at ${slot.start_time}` : "ASAP"}`,
    };
    if (slot?.date && slot?.start_time) {
      enquiryUpdate.appointment_datetime = `${slot.date}T${slot.start_time}:00`;
    }
    await db.from("enquiries").update(enquiryUpdate).eq("id", enquiry_id);
  }

  /* Mark the conversation as having resulted in a booking */
  if (enquiry_id) {
    await db.from("conversations").update({
      outcome: "booking_made",
    }).eq("enquiry_id", enquiry_id);
  }

  let message;
  if (status === "asap") {
    message = outsideHours
      ? "I've put in an urgent request for you. The practice is currently closed but the team will see it as soon as they're in and get back to you."
      : "I've put in an urgent request for you. The team will see it and get back to you as soon as possible.";
  } else {
    message = "I've pencilled that in. The team will confirm and send you a text shortly.";
  }

  return { success: true, request_id: request.id, status, submitted_outside_hours: outsideHours, enquiry_id, message };
}

// deno-lint-ignore no-explicit-any
async function handleLookupWebVisitor(db: any, args: any) {
  const { practice_id, visitor_phone, visitor_email, visitor_name, conversation_id } = args;
  if (!practice_id) return { success: false, message: "Missing practice ID." };

  const { data: practice } = await db
    .from("practices").select("id, name, email, opening_hours, holiday_hours, integrations")
    .eq("id", practice_id).single();
  if (!practice) return { success: false, message: "Practice not found." };

  const practiceHours = getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours);
  const pIntegrations = practice.integrations || {};
  const base = {
    success: true, practice_id: practice.id, practice_name: practice.name,
    practice_email: practice.email || pIntegrations.email_from || null,
    practice_hours: practiceHours,
    email_enabled: !!pIntegrations.email_enabled,
    stripe_connected: !!pIntegrations.stripe_connected,
  };

  // Try to find the contact by phone or email
  let contact = null;
  const normalised = visitor_phone ? normalizePhone(visitor_phone) : null;
  if (visitor_phone) {
    contact = await findContactByPhone(db, practice.id, visitor_phone);
  }
  if (!contact && visitor_email) {
    const { data } = await db
      .from("contacts").select("id, name, phone, email, date_of_birth, address, postcode")
      .eq("practice_id", practice.id).eq("email", visitor_email)
      .limit(1).single();
    contact = data;
  }

  // Create an enquiry for this web chat session
  const enquiryRow = {
    practice_id: practice.id,
    patient_name: contact?.name || visitor_name || "Web Chat Visitor",
    phone_number: normalised || null,
    message: "Web chat session",
    source: "chat",
    is_urgent: false,
    is_completed: false,
    contact_id: contact?.id || null,
  };
  const { data: enquiry } = await db
    .from("enquiries").insert(enquiryRow).select("id").single();

  // Create a conversation record for this session
  const convRow = {
    practice_id: practice.id,
    contact_id: contact?.id || null,
    elevenlabs_conversation_id: conversation_id || null,
    channel: "web_chat",
    status: "active",
    caller_name: contact?.name || visitor_name || null,
    caller_phone: normalised || null,
    enquiry_id: enquiry?.id || null,
  };
  const { data: conv } = await db
    .from("conversations").insert(convRow).select("id").single();

  // Fetch RAG context
  const history = await getConversationHistory(db, {
    contactId: contact?.id,
    phone: normalised || undefined,
    practiceId: practice.id,
  });

  if (contact) {
    return {
      ...base, found: true, contact_id: contact.id, contact_name: contact.name,
      contact_phone: contact.phone, contact_email: contact.email,
      contact_dob: contact.date_of_birth, contact_address: contact.address,
      contact_postcode: contact.postcode,
      enquiry_id: enquiry?.id || null,
      conversation_db_id: conv?.id || null,
      conversation_history: history,
      message: `Account found. Patient name on file: ${contact.name}.`
        + (history ? `\n\n${history}` : ""),
    };
  }

  return {
    ...base, found: false,
    enquiry_id: enquiry?.id || null,
    conversation_db_id: conv?.id || null,
    conversation_history: history,
    message: "No account found with those details."
      + (history ? ` But this person has interacted before:\n\n${history}` : ""),
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const toolName = url.searchParams.get("tool");
    if (!toolName) {
      return new Response(JSON.stringify({ success: false, message: "Missing ?tool= parameter" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = await req.json();
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // deno-lint-ignore no-explicit-any
    let result: any;
    try {
      switch (toolName) {
        case "lookup_caller_phone": result = await handleLookupCallerPhone(db, args); break;
        case "lookup_account_phone": result = await handleLookupAccountPhone(db, args); break;
        case "lookup_web_visitor": result = await handleLookupWebVisitor(db, args); break;
        case "verify_identity": result = await handleVerifyIdentity(db, args); break;
        case "update_address": result = await handleUpdateAddress(db, args); break;
        case "search_availability": result = await handleSearchAvailability(db, args); break;
        case "request_appointment": result = await handleRequestAppointment(db, args); break;
        default: result = { success: false, message: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[ELEVENLABS TOOL] Error in ${toolName}:`, err);
      console.error(`[ELEVENLABS TOOL] ${toolName} detail:`, err instanceof Error ? err.message : String(err));
      result = { success: false, message: "Something went wrong. Please transfer to reception." };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ELEVENLABS TOOL ERROR]", err);
    return new Response(JSON.stringify({ success: false, message: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
