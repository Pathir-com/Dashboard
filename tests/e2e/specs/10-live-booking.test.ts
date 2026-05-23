/**
 * Interactive live booking test — an AI "patient" agent phones a freshly
 * provisioned practice line and books an appointment end to end. This is the
 * only way to prove the *booking commit* over a real interactive call
 * (a scripted Twilio <Say> can't time its "yes"). It also verifies the
 * end_call fix: the call must END cleanly, not loop to the 10-minute cap.
 *
 * GATED behind RUN_LIVE_CALL=1 — it costs real ConvAI minutes + a Twilio
 * call, so a normal `npm test` skips it. Run on demand:
 *   RUN_LIVE_CALL=1 npm test -- 10-live-booking
 *
 * Self-contained: provisions its own practice + number, creates the patient
 * agent, places the call, asserts the appointment committed and the call
 * ended within a sane window, then cleans everything up.
 */

import { afterAll, describe, expect, it } from "vitest";
import { admin } from "../helpers/supabase.ts";
import { deleteAgent } from "../helpers/elevenlabs.ts";
import { loadEnv } from "../helpers/env.ts";
import { runId } from "../helpers/run-id.ts";

const RUN = process.env.RUN_LIVE_CALL === "1";
/* Target an EXISTING, healthy practice line (default: Spark demo) rather
   than provisioning a throwaway one — removes the just-assigned-number
   propagation race and matches what's verified manually (46s call, booking
   commits). Override with LIVE_CALL_TO_NUMBER + LIVE_CALL_PRACTICE_ID. */
const TO_NUMBER = process.env.LIVE_CALL_TO_NUMBER || "+441325796015";
const PRACTICE_ID = process.env.LIVE_CALL_PRACTICE_ID || "7a2d6e46-5941-46a7-b858-88c0483b1e12";
let patientAgentId = "", callSid = "";

async function el(path: string, init?: RequestInit) {
  const env = await loadEnv();
  return fetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
}

describe(`Live interactive booking call [${runId()}]`, () => {
  it("AI patient calls, books, and the call ends cleanly", async () => {
    if (!RUN) { console.log("[10-live-booking] skipped — set RUN_LIVE_CALL=1"); expect(true).toBe(true); return; }
    const number = TO_NUMBER;
    const env = await loadEnv();
    const sb = await admin();
    const practice = { id: PRACTICE_ID };

    // Patient agent (no tools — just converses to book).
    const patientPrompt = "You are Sam Rivers, a patient phoning a dental clinic. Wait for the receptionist to greet you, then ask to book a routine check-up for next Friday morning. If asked, your name is Sam Rivers and your date of birth is the third of March nineteen ninety. When offered a slot, say 'yes, please book that one'. Once they confirm it's booked, thank them and say goodbye. One short sentence per reply.";
    const pa = await el("/v1/convai/agents/create", {
      method: "POST",
      body: JSON.stringify({
        name: `Test Patient ${runId()}`,
        conversation_config: {
          agent: { prompt: { prompt: patientPrompt, llm: "gpt-4o" }, first_message: "", language: "en" },
          tts: { voice_id: "pNInz6obpgDQGcFmaJgB", model_id: "eleven_turbo_v2" },
          turn: { turn_timeout: 20 },
        },
      }),
    }).then((r) => r.json());
    patientAgentId = pa.agent_id;
    expect(patientAgentId).toBeTruthy();

    // A FROM number registered to the patient agent.
    const fromNumber = number === "+441917432540" ? "+441514536380" : "+441917432540";
    const list = await el("/v1/convai/phone-numbers").then((r) => r.json());
    const rows = Array.isArray(list) ? list : (list.phone_numbers || []);
    const existing = rows.find((p: any) => p.phone_number === fromNumber);
    let phnumId = existing?.phone_number_id;
    if (phnumId) {
      await el(`/v1/convai/phone-numbers/${phnumId}`, { method: "PATCH", body: JSON.stringify({ agent_id: patientAgentId }) });
    } else {
      const created = await el("/v1/convai/phone-numbers/create", {
        method: "POST",
        body: JSON.stringify({ phone_number: fromNumber, provider: "twilio", label: "Test Patient FROM", agent_id: patientAgentId, sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN }),
      }).then((r) => r.json());
      phnumId = created.phone_number_id;
    }

    const { count: before } = await sb.from("appointments").select("id", { count: "exact", head: true }).eq("practice_id", practice.id);

    // Place the interactive call: patient agent -> the practice line.
    const call = await el("/v1/convai/twilio/outbound-call", {
      method: "POST",
      body: JSON.stringify({ agent_id: patientAgentId, agent_phone_number_id: phnumId, to_number: number }),
    }).then((r) => r.json());
    expect(call.success, JSON.stringify(call)).toBe(true);
    callSid = call.callSid;

    // Poll for the appointment to commit (up to 4 min).
    await expect.poll(async () => {
      const { count } = await sb.from("appointments").select("id", { count: "exact", head: true }).eq("practice_id", practice.id);
      return count || 0;
    }, { timeout: 240_000, intervals: [5000] }).toBeGreaterThan(before || 0);

    // The call must have ENDED (not still looping). Check Twilio call status + duration.
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    await expect.poll(async () => {
      const c = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`, { headers: { Authorization: `Basic ${auth}` } }).then((r) => r.json());
      return c.status;
    }, { timeout: 120_000, intervals: [5000] }).toBe("completed");

    const final = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`, { headers: { Authorization: `Basic ${auth}` } }).then((r) => r.json());
    // end_call fix: a clean booking + goodbye should finish well under the
    // 600s cap. If it ran the full 600s, the agent never hung up.
    expect(Number(final.duration), `call duration ${final.duration}s — should end before the 600s cap`).toBeLessThan(540);
  }, 420_000);
});

afterAll(async () => {
  if (!RUN) return;
  // Only the throwaway patient agent is ours to delete — the target
  // practice is an existing one we deliberately don't touch.
  if (patientAgentId) try { await deleteAgent(patientAgentId); } catch { /* */ }
});
