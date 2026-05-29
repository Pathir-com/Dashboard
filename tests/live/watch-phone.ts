/**
 * Live phone-number watcher. Tails the database for everything a given
 * phone number touches at a practice — contact, enquiries, enquiry_messages,
 * appointments, conversations — and prints each new row the moment it lands.
 *
 * Use case: manual end-to-end smoke test of two-way SMS (and cross-channel
 * call recall). You text the practice from your phone; this prints exactly
 * what hits the database in real time, so you can see "all is streamed to
 * the booking" without flipping between tabs.
 *
 * Run:
 *   PHONE="+353851110071" PRACTICE_ID="7a2d6e46-..." \
 *     npx tsx tests/live/watch-phone.ts
 *
 * Stop with Ctrl+C. Polls every 2s, prints DB-state deltas only.
 */

import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "../../supabase/functions/_shared/match-contact.ts";
import { loadEnv } from "../e2e/helpers/env.ts";

const PHONE = process.env.PHONE;
const PRACTICE_ID = process.env.PRACTICE_ID || "7a2d6e46-5941-46a7-b858-88c0483b1e12"; // Spark default
if (!PHONE) { console.error("Set PHONE=+353851110071 (and optional PRACTICE_ID)"); process.exit(1); }

const normalised = normalizePhone(PHONE);
const altForm = PHONE.startsWith("+44") ? "0" + PHONE.slice(3) : PHONE.startsWith("0") ? "+44" + PHONE.slice(1) : null;
const matchSet = [PHONE, normalised, altForm].filter(Boolean) as string[];

const seen = { contacts: new Set<string>(), enquiries: new Set<string>(), messages: new Set<string>(), appts: new Set<string>(), convos: new Set<string>() };
const since = new Date(Date.now() - 60_000).toISOString(); // surface anything new in the last minute too

function stamp() { return new Date().toLocaleTimeString("en-GB"); }
function head(label: string) { console.log(`\n[${stamp()}] ${label}`); }

// deno-lint-ignore no-explicit-any
let sb: any;

async function findContacts() {
  const { data } = await sb.from("contacts").select("id, name, phone, email, date_of_birth, created_at")
    .eq("practice_id", PRACTICE_ID).in("phone", matchSet);
  return data || [];
}

async function tick() {
  const contacts = await findContacts();
  for (const c of contacts) {
    if (seen.contacts.has(c.id)) continue;
    seen.contacts.add(c.id);
    head(`CONTACT ${seen.contacts.size === 1 ? "matched" : "new"}: ${c.name || "(unnamed)"} <${c.phone}>  id=${c.id.slice(0, 8)}`);
  }
  const contactIds = contacts.map((c) => c.id);
  if (contactIds.length === 0) return;

  const [{ data: enqs }, { data: msgs }, { data: appts }, { data: convos }] = await Promise.all([
    sb.from("enquiries").select("id, source, message, is_completed, patient_name, created_at")
      .eq("practice_id", PRACTICE_ID).in("contact_id", contactIds).gte("created_at", since).order("created_at"),
    sb.from("enquiry_messages").select("id, enquiry_id, role, channel, message, created_at")
      .in("enquiry_id", (await sb.from("enquiries").select("id").eq("practice_id", PRACTICE_ID).in("contact_id", contactIds)).data?.map((e) => e.id) || []).gte("created_at", since).order("created_at"),
    sb.from("appointments").select("id, starts_at, status, source, created_at")
      .eq("practice_id", PRACTICE_ID).in("contact_id", contactIds).gte("created_at", since).order("created_at"),
    sb.from("conversations").select("id, channel, status, elevenlabs_conversation_id, enquiry_id, created_at")
      .eq("practice_id", PRACTICE_ID).in("contact_id", contactIds).gte("created_at", since).order("created_at"),
  ]);

  for (const e of enqs || []) {
    if (seen.enquiries.has(e.id)) continue;
    seen.enquiries.add(e.id);
    head(`ENQUIRY ${e.source.toUpperCase()}: "${(e.message || "").slice(0, 50)}"  id=${e.id.slice(0, 8)}`);
  }
  for (const m of msgs || []) {
    if (seen.messages.has(m.id)) continue;
    seen.messages.add(m.id);
    const arrow = m.role === "patient" ? "→" : "←";
    console.log(`         ${arrow} [${m.channel}/${m.role}] ${(m.message || "").slice(0, 90)}`);
  }
  for (const a of appts || []) {
    if (seen.appts.has(a.id)) continue;
    seen.appts.add(a.id);
    const london = new Date(a.starts_at).toLocaleString("en-GB", { timeZone: "Europe/London" });
    head(`APPOINTMENT BOOKED: ${london} London  (source=${a.source}, ${a.status})`);
  }
  for (const c of convos || []) {
    if (seen.convos.has(c.id)) continue;
    seen.convos.add(c.id);
    head(`CONVERSATION started: ${c.channel}  enquiry=${(c.enquiry_id || "").slice(0, 8)}  el=${(c.elevenlabs_conversation_id || "").slice(0, 14) || "-"}`);
  }
}

async function main() {
  const env = await loadEnv();
  sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  console.log(`Watching ${PHONE} (also matches ${matchSet.join(", ")}) at practice ${PRACTICE_ID.slice(0, 8)}…`);
  console.log("Text or call Spark from this number now — I'll print every row as it lands.\n");
  await tick();
  setInterval(tick, 2000);
}
main().catch((e) => { console.error(e); process.exit(1); });
