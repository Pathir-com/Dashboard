/**
 * Integration toggle + provider swap tests.
 *
 * Verifies the practice.integrations JSONB shape is read consistently across:
 *   - Dashboard (we just exercise the DB layer; UI tests live elsewhere)
 *   - The shared sms.ts resolver (provider priority Vonage > SignalWire >
 *     TextMagic > Twilio when no explicit `sms_provider` is set; explicit
 *     wins)
 *
 * The resolver lives in supabase/functions/_shared/sms.ts. We import its
 * public function `resolveProvider` and feed it synthetic practice rows.
 * This is a pure unit test — no external API calls.
 */

import { describe, expect, it } from "vitest";
import { resolveProvider } from "../../../supabase/functions/_shared/sms.ts";

describe("SMS provider resolver — every config shape", () => {
  it("explicit twilio wins", () => {
    expect(resolveProvider({
      id: "x", name: "x",
      integrations: { sms_provider: "twilio", textmagic: { enabled: true, phone_number: "+44..." } },
    })).toBe("twilio");
  });

  it("explicit textmagic wins", () => {
    expect(resolveProvider({
      id: "x", name: "x",
      integrations: { sms_provider: "textmagic", vonage: { enabled: true, phone_number: "+44..." } },
    })).toBe("textmagic");
  });

  it("explicit vonage wins", () => {
    expect(resolveProvider({
      id: "x", name: "x",
      integrations: { sms_provider: "vonage" },
    })).toBe("vonage");
  });

  it("explicit signalwire wins", () => {
    expect(resolveProvider({
      id: "x", name: "x",
      integrations: { sms_provider: "signalwire" },
    })).toBe("signalwire");
  });

  it("inferred priority: vonage > signalwire > textmagic > twilio", () => {
    expect(resolveProvider({
      id: "x", name: "x",
      integrations: {
        vonage:     { enabled: true, phone_number: "+1" },
        signalwire: { enabled: true, phone_number: "+2" },
        textmagic:  { enabled: true, phone_number: "+3" },
      },
    })).toBe("vonage");

    expect(resolveProvider({
      id: "x", name: "x",
      integrations: {
        signalwire: { enabled: true, phone_number: "+2" },
        textmagic:  { enabled: true, phone_number: "+3" },
      },
    })).toBe("signalwire");

    expect(resolveProvider({
      id: "x", name: "x",
      integrations: {
        textmagic: { enabled: true, phone_number: "+3" },
      },
    })).toBe("textmagic");
  });

  it("falls back to twilio when nothing is configured", () => {
    expect(resolveProvider({ id: "x", name: "x", integrations: {} })).toBe("twilio");
    expect(resolveProvider({ id: "x", name: "x" })).toBe("twilio");
  });

  it("disabled provider is ignored in inference", () => {
    expect(resolveProvider({
      id: "x", name: "x",
      integrations: {
        textmagic: { enabled: false, phone_number: "+3" },
      },
    })).toBe("twilio");
  });

  it("provider configured but missing phone_number is ignored", () => {
    expect(resolveProvider({
      id: "x", name: "x",
      integrations: { vonage: { enabled: true } },
    })).toBe("twilio");
  });
});
