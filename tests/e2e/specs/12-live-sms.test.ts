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

/* Deterministic patient. Pattern-matches the agent's last reply, chooses
   the next thing to say. Replace with a Claude/GPT call when a key lands;
   the contract is identical (last reply in, next text out). */
function nextPatientReply(agentText: string): { text: string; done: boolean } {
  const t = (agentText || "").toLowerCase();
  if (/booked|confirmed|all set|booked in/.test(t)) return { text: "Thank you, goodbye!", done: true };
  if (/another|different time|alternative|earliest|how about|works for you|at \d|noon|morning|afternoon/.test(t)) return { text: "Yes, please book that one.", done: false };
  if (/name|date of birth|dob|details|who/.test(t)) return { text: "Sam Rivers, 3rd March 1990.", done: false };
  return { text: "Yes please go ahead.", done: false };
}

describe(`Live two-way SMS [${runId()}]`, () => {
  it("SMS round-trip → booking → cross-channel call recall", async () => {
    if (!RUN) { console.log("[12-live-sms] skipped — set RUN_LIVE_SMS=1"); expect(true).toBe(true); return; }
    const sb = await admin();
    const env = await loadEnv();
    const testStart = new Date().toISOString();
    const { count: appBefore } = await sb.from("appointments").select("id", { count: "exact", head: true }).eq("practice_id", SPARK_ID);
    const { data: contactBefore } = await sb.from("contacts").select("id").eq("practice_id", SPARK_ID).eq("phone", PATIENT).limit(1).single();

    // ── 1. Patient sends initial inbound text (all key info upfront) ──
    const opening = `Hi, I'd like to book a routine check-up please. I'm Sam Rivers, DOB 3rd March 1990. Anything Friday around 10am works.`;
    await twilioSend(PATIENT, SPARK_SMS, opening);

    // ── 2. Multi-turn loop ──
    const seen = new Set<string>();
    let lastReply = "";
    for (let turn = 0; turn < 6; turn++) {
      const reply = await pollInboundFor(PATIENT, testStart, seen, 90_000);
      if (!reply) { console.log(`[12-live-sms] no reply within 90s on turn ${turn}`); break; }
      lastReply = reply.body;
      console.log(`[12-live-sms] turn ${turn}: agent → ${reply.body.slice(0, 80)}`);
      const next = nextPatientReply(reply.body);
      await twilioSend(PATIENT, SPARK_SMS, next.text);
      console.log(`[12-live-sms] turn ${turn}: patient → ${next.text}`);
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
