/**
 * Regression guard: every provider-facing webhook must be publicly
 * reachable. Vonage and SignalWire silently drifted to verify_jwt=true
 * because old deploys predate the workflow's --no-verify-jwt flag and
 * never got redeployed; real providers' inbound got 401 and the
 * integration was dead-on-arrival. This test catches that — POST with no
 * auth header to each webhook and assert it's NOT a 401.
 *
 * Free (calls our own functions; webhooks return OK on empty/garbage
 * input by design), so runs in the normal suite — no gate.
 */

import { describe, expect, it } from "vitest";
import { loadEnv } from "../helpers/env.ts";

const WEBHOOKS = [
  "twilio-sms-webhook",
  "textmagic-webhook",
  "vonage-webhook",
  "signalwire-webhook",
  "meta-webhook",
  "chatbase-webhook",
  "vapi-webhook",
  "elevenlabs-webhook",
];

describe("Inbound webhooks must be publicly reachable", () => {
  for (const fn of WEBHOOKS) {
    it(`${fn} accepts unauthenticated POST (no 401)`, async () => {
      const env = await loadEnv();
      const r = await fetch(`${env.SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
      });
      expect(r.status, `${fn} returned ${r.status} — set verify_jwt:false (real providers don't send Supabase JWTs)`).not.toBe(401);
    }, 15_000);
  }
});
