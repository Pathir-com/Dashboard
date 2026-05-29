/**
 * Live two-way SMS harness — the equivalent of 10-live-booking, for text.
 *
 * The patient (a UK Twilio spare we own) sends an inbound SMS to Spark's
 * messaging-service line (+447428320181). The real platform handles it:
 * twilio-sms-webhook → ai-reply → outbound SMS back to the patient. The
 * test loops: poll patient inbox → scripted-patient picks next reply →
 * send → repeat until booked or 6 turns.
 *
 * GATED behind RUN_LIVE_SMS=1 (costs ~6 SMS ≈ £0.30–£0.60 + ~£0.05 for
 * the cross-channel call leg).
 *
 *   RUN_LIVE_SMS=1 npm test -- 12-live-sms
 *
 * Cross-channel: after the SMS booking is in, the patient AGENT calls Spark
 * from the SAME number. Assertion: lookup_caller_phone resolves the SAME
 * contact (no duplicate created), proving normalized-phone-as-spine recall
 * across SMS and voice.
 *
 * Patient brain: deterministic, pattern-matches the agent's reply
 * ("slot/available" → "yes book it", "booked/confirmed" → "thank you,
 * goodbye"). Swap in a Claude/GPT call here when ANTHROPIC_API_KEY lands.
 */

import { afterAll, describe, expect, it } from "vitest";
import { admin } from "../helpers/supabase.ts";
import { deleteAgent } from "../helpers/elevenlabs.ts";
import { loadEnv } from "../helpers/env.ts";
import { runId } from "../helpers/run-id.ts";

const RUN = process.env.RUN_LIVE_SMS === "1";

/* Spark = the target practice (existing, healthy). Patient = a UK Twilio
   spare we own — both SMS-capable AND used as the ElevenLabs phnum for
   the cross-channel outbound call. Override via env for re-use elsewhere. */
const SPARK_SMS  = process.env.LIVE_SMS_PRACTICE_NUMBER || "+447428320181";
const SPARK_VOICE = process.env.LIVE_SMS_PRACTICE_VOICE  || "+441325796015";
const SPARK_ID   = process.env.LIVE_SMS_PRACTICE_ID     || "7a2d6e46-5941-46a7-b858-88c0483b1e12";
const PATIENT    = process.env.LIVE_SMS_PATIENT_NUMBER  || "+441514536380";

let patientAgentId = "";

async function twilioSend(from: string, to: string, body: string) {
  const env = await loadEnv();
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  if (!r.ok) throw new Error(`twilio send ${r.status}: ${await r.text()}`);
  return r.json();
}

async function pollInboundFor(patient: string, sinceIso: string, alreadySeen: Set<string>, timeoutMs = 90_000): Promise<{ sid: string; body: string } | null> {
  const env = await loadEnv();
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json?To=${encodeURIComponent(patient)}&DateSent%3E=${sinceIso.slice(0, 10)}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (r.ok) {
      const d = await r.json() as { messages?: Array<{ sid: string; body: string; date_sent: string; direction: string }> };
      const fresh = (d.messages || [])
        .filter((m) => m.direction === "inbound" || m.direction === "outbound-api" || m.direction.includes("outbound"))
        .filter((m) => m.date_sent && new Date(m.date_sent).toISOString() >= sinceIso)
        .filter((m) => !alreadySeen.has(m.sid))
        .sort((a, b) => new Date(a.date_sent).getTime() - new Date(b.date_sent).getTime());
      if (fresh[0]) { alreadySeen.add(fresh[0].sid); return { sid: fresh[0].sid, body: fresh[0].body }; }
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return null;
}

/* Patient brain — tries Claude (ANTHROPIC_API_KEY) → GPT (OPENAI_API_KEY)
   → scripted fallback. No SDK; both APIs are plain HTTP. Drop either key
   in env and the test "upgrades" itself to a natural LLM-driven patient.
   The contract is the same in all three modes: full chat so far in, next
   patient text + done flag out. */
const PATIENT_PERSONA = `You are Sam Rivers, a patient texting a dental clinic to book an appointment. Goal: get a routine check-up booked for next Friday morning. If asked your name, say Sam Rivers; DOB 3rd March 1990. When a specific slot is offered, accept it ("Yes please book that one"). Once the clinic confirms it's booked, reply "Thank you, goodbye!" and stop. One short SMS-style sentence per reply. Reply with JUST the text you would send — no labels, no quotes, no explanation.`;

interface ChatTurn { role: "clinic" | "patient"; text: string }

async function claudeTurn(history: ChatTurn[]): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const messages = history.map((t) => ({ role: t.role === "patient" ? "assistant" : "user", content: t.text }));
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(start)" });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 100, system: PATIENT_PERSONA, messages }),
  });
  if (!r.ok) { console.log(`[patient-brain] claude ${r.status}: ${(await r.text()).slice(0, 120)}`); return null; }
  const d = await r.json() as { content: Array<{ text: string }> };
  return d.content?.[0]?.text?.trim() || null;
}

async function gptTurn(history: ChatTurn[]): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const messages: any[] = [{ role: "system", content: PATIENT_PERSONA }];
  for (const t of history) messages.push({ role: t.role === "patient" ? "assistant" : "user", content: t.text });
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 100, messages }),
  });
  if (!r.ok) { console.log(`[patient-brain] gpt ${r.status}: ${(await r.text()).slice(0, 120)}`); return null; }
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  return d.choices?.[0]?.message?.content?.trim() || null;
}

function scriptedTurn(agentText: string): string {
  const t = (agentText || "").toLowerCase();
  if (/booked|confirmed|all set|booked in/.test(t)) return "Thank you, goodbye!";
  if (/another|different time|alternative|earliest|how about|works for you|at \d|noon|morning|afternoon/.test(t)) return "Yes, please book that one.";
  if (/name|date of birth|dob|details|who/.test(t)) return "Sam Rivers, 3rd March 1990.";
  return "Yes please go ahead.";
}

async function nextPatientReply(history: ChatTurn[]): Promise<{ text: string; done: boolean; brain: string }> {
  const last = history.findLast?.((t) => t.role === "clinic")?.text || "";
  const text =
    (await claudeTurn(history)) ??
    (await gptTurn(history)) ??
    scriptedTurn(last);
  const brain = process.env.ANTHROPIC_API_KEY ? "claude" : process.env.OPENAI_API_KEY ? "gpt" : "scripted";
  // "Done" is decided by content not source — same termination rule whichever brain spoke.
  const done = /goodbye|^thank you[!.]*$|^thanks[!.]*$/i.test(text.trim());
  return { text, done, brain };
}

describe(`Live two-way SMS [${runId()}]`, () => {
  it("SMS round-trip → booking → cross-channel call recall", async () => {
    if (!RUN) { console.log("[12-live-sms] skipped — set RUN_LIVE_SMS=1"); expect(true).toBe(true); return; }
    const sb = await admin();
    const env = await loadEnv();
    /* Pre-check: UK geographic numbers (+44 1xx/2xx) aren't SMS-capable in
       Twilio. Skip with a clear message rather than fail — running the
       suite shouldn't be blocked by infra we can't always procure (UK
       mobile inventory is regularly empty). Set LIVE_SMS_PATIENT_NUMBER to
       a verified SMS-capable Twilio number to actually run. */
    const auth0 = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const probe = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(PATIENT)}`, { headers: { Authorization: `Basic ${auth0}` } }).then((r) => r.json()).catch(() => null);
    const cap = probe?.incoming_phone_numbers?.[0]?.capabilities?.sms;
    if (!cap) { console.log(`[12-live-sms] skipped — ${PATIENT} is not SMS-capable (set LIVE_SMS_PATIENT_NUMBER to a UK mobile we own)`); expect(true).toBe(true); return; }
    const testStart = new Date().toISOString();
    const { count: appBefore } = await sb.from("appointments").select("id", { count: "exact", head: true }).eq("practice_id", SPARK_ID);
    const { data: contactBefore } = await sb.from("contacts").select("id").eq("practice_id", SPARK_ID).eq("phone", PATIENT).limit(1).single();

    // ── 1. Patient sends initial inbound text (all key info upfront) ──
    const opening = `Hi, I'd like to book a routine check-up please. I'm Sam Rivers, DOB 3rd March 1990. Anything Friday around 10am works.`;
    await twilioSend(PATIENT, SPARK_SMS, opening);

    // ── 2. Multi-turn loop ──
    const seen = new Set<string>();
    const history: ChatTurn[] = [{ role: "patient", text: opening }];
    for (let turn = 0; turn < 6; turn++) {
      const reply = await pollInboundFor(PATIENT, testStart, seen, 90_000);
      if (!reply) { console.log(`[12-live-sms] no reply within 90s on turn ${turn}`); break; }
      history.push({ role: "clinic", text: reply.body });
      console.log(`[12-live-sms] turn ${turn}: agent → ${reply.body.slice(0, 80)}`);
      const next = await nextPatientReply(history);
      await twilioSend(PATIENT, SPARK_SMS, next.text);
      history.push({ role: "patient", text: next.text });
      console.log(`[12-live-sms] turn ${turn}: [${next.brain}] patient → ${next.text}`);
      if (next.done) break;
    }

    // ── 3. DB assertions: everything streamed to the booking ──
    const { count: appAfter } = await sb.from("appointments").select("id", { count: "exact", head: true }).eq("practice_id", SPARK_ID);
    expect(appAfter || 0, `appts before ${appBefore}, after ${appAfter}`).toBeGreaterThan(appBefore || 0);

    const { data: contactAfter } = await sb.from("contacts").select("id").eq("practice_id", SPARK_ID).eq("phone", PATIENT).limit(1).single();
    expect(contactAfter?.id, "contact must exist for the patient number").toBeTruthy();
    if (contactBefore) expect(contactAfter?.id, "must NOT create a duplicate contact").toBe(contactBefore.id);

    const { data: enq } = await sb.from("enquiries").select("id, source").eq("practice_id", SPARK_ID).eq("contact_id", contactAfter!.id).gte("created_at", testStart).order("created_at", { ascending: false }).limit(1).single();
    expect(enq?.id, "enquiry must be created from the SMS exchange").toBeTruthy();

    const { data: msgs } = await sb.from("enquiry_messages").select("role, channel, created_at").eq("enquiry_id", enq!.id).order("created_at");
    expect((msgs || []).length, "must persist multiple alternating messages").toBeGreaterThanOrEqual(2);

    // ── 4. CROSS-CHANNEL: same patient number now CALLS Spark — must match the SAME contact ──
    console.log(`[12-live-sms] cross-channel: creating patient agent + calling Spark from ${PATIENT}`);
    const patientPrompt = `You are Sam Rivers calling back to confirm your appointment. Wait for the greeting, then say "Hi, I just texted you to book a check-up — I wanted to call and confirm it's all in." Then say "thank you, goodbye" and stop. One short sentence per reply.`;
    const pa = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `TestPatient CrossChan ${runId()}`,
        conversation_config: {
          agent: { prompt: { prompt: patientPrompt, llm: "gpt-4o" }, first_message: "", language: "en" },
          tts: { voice_id: "pNInz6obpgDQGcFmaJgB", model_id: "eleven_turbo_v2" },
          turn: { turn_timeout: 20 },
        },
      }),
    }).then((r) => r.json());
    patientAgentId = pa.agent_id;
    const phList = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers", { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }).then((r) => r.json());
    const phRows = Array.isArray(phList) ? phList : (phList.phone_numbers || []);
    const phnumId = phRows.find((p: any) => p.phone_number === PATIENT)?.phone_number_id;
    expect(phnumId, `patient number ${PATIENT} must be registered as an EL phnum`).toBeTruthy();
    await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${phnumId}`, { method: "PATCH", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: patientAgentId }) });
    const call = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", { method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: patientAgentId, agent_phone_number_id: phnumId, to_number: SPARK_VOICE }) }).then((r) => r.json());
    expect(call.success, `call placement: ${JSON.stringify(call)}`).toBe(true);

    // Wait for the call to create activity, then check no duplicate contact appeared.
    await new Promise((r) => setTimeout(r, 30_000));
    const { data: contactsAfterCall } = await sb.from("contacts").select("id").eq("practice_id", SPARK_ID).eq("phone", PATIENT);
    expect((contactsAfterCall || []).length, "must STILL be exactly one contact for this number (no SMS→call duplication)").toBe(1);
    expect(contactsAfterCall![0].id, "must be the SAME contact as the SMS one").toBe(contactAfter!.id);
  }, 600_000);
});

afterAll(async () => {
  if (!RUN) return;
  if (patientAgentId) try { await deleteAgent(patientAgentId); } catch { /* */ }
});
