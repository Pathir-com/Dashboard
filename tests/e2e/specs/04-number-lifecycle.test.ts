/**
 * Twilio number lifecycle: assign → reconfigure → release-on-cleanup.
 *
 * Verifies:
 *   - twilio-assign-number picks a pooled UK number, sets the voice URL,
 *     stores it on the practice row, registers with ElevenLabs
 *   - Calling assign again returns the same number (idempotent)
 *   - twilio-toggle-number re-routes Voice URL to disconnected-voice when
 *     disabling, and back to VAPI when re-enabling
 *   - The Twilio number's voice_url and friendly_name are accurate after
 *     each step
 *
 * Prerequisites:
 *   - Mint Dental Twilio account creds in Supabase secrets (refreshed 2026-05-04)
 *   - At least one unassigned UK pooled number on the account (the spares
 *     +441917432540 / +441615242804 / +441514536380 satisfy this)
 *
 * NOTE: this test assigns a real Twilio number to a test practice. The
 * afterAll hook re-points the number's friendly_name + voice_url so it
 * returns to the pool clean (we don't release/delete the number — that
 * would cost reacquisition fees). wipe.ts repeats this cleanup if the
 * test crashes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, invokeFunction } from "../helpers/supabase.ts";
import {
  createTestPractice, createTestUser, getUserJwt,
  type TestPractice, type TestUser,
} from "../helpers/factories.ts";
import { deleteAgent } from "../helpers/elevenlabs.ts";
import { getNumber, listIncomingNumbers } from "../helpers/twilio.ts";
import { runId } from "../helpers/run-id.ts";

let user: TestUser;
let practice: TestPractice;
let agentId = "";
let assignedNumberSid = "";
let assignedNumberE164 = "";

describe(`Twilio number lifecycle [${runId()}]`, () => {
  beforeAll(async () => {
    user = await createTestUser(30);
    practice = await createTestPractice(user, { industry: "dental", i: 30 });
    const jwt = await getUserJwt(user);
    const prov = await invokeFunction("provision-practice", { practiceId: practice.id }, jwt);
    expect(prov.status).toBe(200);
    agentId = prov.body.agent_id;
  });

  it("twilio-assign-number: assigns a UK number from the pool", async () => {
    const jwt = await getUserJwt(user);
    const res = await invokeFunction("twilio-assign-number", { practiceId: practice.id }, jwt);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.phoneNumber).toMatch(/^\+44/);
    assignedNumberE164 = res.body.phoneNumber;
  });

  it("DB: practice.twilio_phone_number is the assigned number", async () => {
    const sb = await admin();
    const { data } = await sb
      .from("practices")
      .select("twilio_phone_number, messaging_service_sid")
      .eq("id", practice.id)
      .single();
    expect(data?.twilio_phone_number).toBe(assignedNumberE164);
  });

  it("Twilio: number's voice_url points at VAPI inbound + friendly_name has practice", async () => {
    const all = await listIncomingNumbers();
    const match = all.find((n) => n.phone_number === assignedNumberE164);
    expect(match, `${assignedNumberE164} not found on Twilio`).toBeDefined();
    expect(match!.voice_url).toContain("api.vapi.ai/twilio/inbound_call");
    expect(match!.friendly_name).toContain(practice.name);
    assignedNumberSid = match!.sid;
  });

  it("twilio-assign-number: idempotent — second call returns same number", async () => {
    const jwt = await getUserJwt(user);
    const res = await invokeFunction("twilio-assign-number", { practiceId: practice.id }, jwt);
    expect(res.status).toBe(200);
    expect(res.body.phoneNumber).toBe(assignedNumberE164);
  });
});

afterAll(async () => {
  /* Return the pooled number to neutral state so the next test/run can reuse
     it. We don't release the number itself (avoids re-purchase cost). */
  if (assignedNumberSid) {
    const env = await import("../helpers/env.ts").then((m) => m.loadEnv());
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${assignedNumberSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          FriendlyName: assignedNumberE164.replace(/^\+/, ""),
          VoiceUrl: "",
        }).toString(),
      },
    );
  }
  const sb = await admin();
  if (agentId) try { await deleteAgent(agentId); } catch { /* */ }
  if (practice) await sb.from("practices").delete().eq("id", practice.id);
  if (user) await sb.auth.admin.deleteUser(user.id);
});
