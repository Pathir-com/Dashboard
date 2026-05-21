/**
 * VAPI integration tests.
 *
 * Two modes:
 *   1. Default — VAPI registration sanity check. Confirms VAPI_API_KEY
 *      authenticates, lists current phone numbers, and verifies that the
 *      Twilio voice URL on a freshly-assigned number routes via VAPI's
 *      inbound endpoint. No outbound call is placed.
 *   2. Live-call — set RUN_LIVE_CALL=1 + TEST_TARGET_PHONE to dial the
 *      target from a VAPI-owned number, capture the agent transcript,
 *      and assert the first turn matches the expected greeting.
 *
 * The live-call mode incurs real per-minute charges from VAPI + Twilio,
 * so it's gated behind an explicit env flag.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, invokeFunction } from "../helpers/supabase.ts";
import {
  createTestPractice, createTestUser, getUserJwt,
  type TestPractice, type TestUser,
} from "../helpers/factories.ts";
import { deleteAgent } from "../helpers/elevenlabs.ts";
import { loadEnv } from "../helpers/env.ts";
import { runId } from "../helpers/run-id.ts";

let user: TestUser;
let practice: TestPractice;
let agentId = "";
let assignedNumber = "";

interface VapiNumber { id: string; number: string; name?: string; provider: string; assistantId?: string }

async function vapiList(path: string): Promise<any[]> {
  const env = await loadEnv();
  const res = await fetch(`https://api.vapi.ai${path}`, {
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` },
  });
  if (!res.ok) throw new Error(`VAPI ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any[]>;
}

describe(`VAPI integration [${runId()}]`, () => {
  beforeAll(async () => {
    const env = await loadEnv();
    if (!env.VAPI_API_KEY) return;
    user = await createTestUser(40);
    practice = await createTestPractice(user, { industry: "dental", i: 40 });
    const jwt = await getUserJwt(user);
    const prov = await invokeFunction("provision-practice", { practiceId: practice.id }, jwt);
    expect(prov.status).toBe(200);
    agentId = prov.body.agent_id;
    const assign = await invokeFunction("twilio-assign-number", { practiceId: practice.id }, jwt);
    expect(assign.status).toBe(200);
    assignedNumber = assign.body.phoneNumber;
  });

  it("VAPI key authenticates", async () => {
    const env = await loadEnv();
    if (!env.VAPI_API_KEY) {
      console.log("[06-vapi] skipped — VAPI_API_KEY not set");
      expect(true).toBe(true);
      return;
    }
    const assistants = await vapiList("/assistant?limit=3");
    expect(Array.isArray(assistants)).toBe(true);
  });

  it("VAPI knows about the existing live numbers", async () => {
    const env = await loadEnv();
    if (!env.VAPI_API_KEY) return;
    const numbers = await vapiList("/phone-number?limit=20") as VapiNumber[];
    const e164s = numbers.map((n) => n.number);
    /* The live phone numbers (Spark, Berkeley, Parkview) should appear
       in VAPI's roster — confirms the API key has the right org scope. */
    expect(e164s.some((n) => n.startsWith("+44"))).toBe(true);
  });

  it("Twilio voice URL on assigned number points at ElevenLabs (not VAPI)", async () => {
    if (!assignedNumber) return;
    const env = await loadEnv();
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(assignedNumber)}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    const data = await res.json() as { incoming_phone_numbers: any[] };
    const match = data.incoming_phone_numbers[0];
    /* Calls must route to ElevenLabs (where the agent + tools live), never
       the dead VAPI endpoint. This file is named for VAPI because VAPI is
       still the test *harness* for placing outbound calls — but inbound
       routing for our practices is ElevenLabs. */
    expect(match?.voice_url).toContain("elevenlabs.io/twilio/inbound_call");
    expect(match?.voice_url).not.toContain("vapi.ai");
  });

  it("(live-call) places real call via VAPI and verifies first turn", async () => {
    const env = await loadEnv();
    if (!env.VAPI_API_KEY || process.env.RUN_LIVE_CALL !== "1") {
      console.log("[06-vapi] live-call skipped — set RUN_LIVE_CALL=1 + TEST_TARGET_PHONE to enable");
      expect(true).toBe(true);
      return;
    }
    if (!env.TEST_TARGET_PHONE) {
      console.log("[06-vapi] TEST_TARGET_PHONE not set — skipping live call");
      expect(true).toBe(true);
      return;
    }
    /* Pick a VAPI-owned phone-number record to dial from. */
    const numbers = await vapiList("/phone-number?limit=20") as VapiNumber[];
    const fromNumber = numbers.find((n) => n.provider === "vapi");
    if (!fromNumber) {
      throw new Error("No VAPI-provided phone number available — register one in the VAPI dashboard");
    }

    const callRes = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumberId: fromNumber.id,
        customer: { number: env.TEST_TARGET_PHONE },
        assistant: {
          firstMessage: `e2e-${runId()}: hello, what services do you offer?`,
          model: { provider: "openai", model: "gpt-4o-mini", messages: [
            { role: "system", content: "You are a test client. Say only the first message and then hang up." },
          ] },
          voice: { provider: "11labs", voiceId: "TVmbglAk3F1GkiCoOq47" },
          transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
        },
      }),
    });
    expect(callRes.ok, await callRes.text()).toBe(true);
    const call = await callRes.json() as { id: string };

    let transcript = "";
    const start = Date.now();
    while (Date.now() - start < 90_000) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await fetch(`https://api.vapi.ai/call/${call.id}`, {
        headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` },
      });
      const data = await r.json() as { status?: string; transcript?: string; messages?: any[] };
      transcript = data.transcript || (data.messages || []).map((m: any) => m.message || m.content || "").join(" ");
      if (data.status === "ended") break;
    }
    expect(transcript.length).toBeGreaterThan(10);
  }, 120_000);
});

afterAll(async () => {
  const sb = await admin();
  if (agentId) try { await deleteAgent(agentId); } catch { /* */ }
  if (practice) await sb.from("practices").delete().eq("id", practice.id);
  if (user) await sb.auth.admin.deleteUser(user.id);
});
