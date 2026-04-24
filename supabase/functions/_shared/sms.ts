/**
 * Shared SMS sending. Picks Twilio vs TextMagic based on the practice's
 * integrations config so every outbound path (dashboard send-sms, reminders,
 * AI auto-replies from webhooks) transparently uses the right provider.
 *
 * Practice config shape (in the `integrations` JSONB column):
 *   integrations.sms_provider        // "twilio" | "textmagic" — defaults to twilio
 *   integrations.textmagic = {
 *     phone_number: "+447418341716", // the TextMagic number the practice owns
 *     sender_id: "Spark Dental",     // optional alpha sender (falls back to phone_number)
 *     enabled: true,
 *   }
 *
 * Twilio settings continue to live on the practice row top-level columns
 * (messaging_service_sid, twilio_sms_number, twilio_phone_number).
 *
 * Used by:
 *   - supabase/functions/send-sms/index.ts
 *   - supabase/functions/textmagic-webhook/index.ts (AI auto-reply)
 *   - supabase/functions/twilio-sms-webhook/index.ts (if it ever needs to send)
 *   - supabase/functions/send-reminders/index.ts
 *
 * Changes:
 *   2026-04-24: Initial — TextMagic support + provider abstraction.
 */

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TEXTMAGIC_USERNAME = Deno.env.get("TEXTMAGIC_USERNAME") || "";
const TEXTMAGIC_API_KEY = Deno.env.get("TEXTMAGIC_API_KEY") || "";

export interface SmsPractice {
  id: string;
  name: string;
  // deno-lint-ignore no-explicit-any
  integrations?: Record<string, any> | null;
  messaging_service_sid?: string | null;
  twilio_sms_number?: string | null;
  twilio_phone_number?: string | null;
}

export interface SmsResult {
  provider: "twilio" | "textmagic";
  messageId: string;
  status: string;
  from: string;
  to: string;
}

export class SmsError extends Error {
  constructor(
    message: string,
    public readonly provider: "twilio" | "textmagic" | "none",
    public readonly statusCode: number = 400,
    public readonly providerCode?: string | number,
  ) {
    super(message);
    this.name = "SmsError";
  }
}

/** Which provider should this practice send SMS through? */
export function resolveProvider(practice: SmsPractice): "twilio" | "textmagic" {
  const configured = practice.integrations?.sms_provider;
  if (configured === "textmagic") return "textmagic";
  if (configured === "twilio") return "twilio";
  // No explicit choice → infer: TextMagic if it's configured+enabled, else Twilio.
  const tm = practice.integrations?.textmagic;
  if (tm?.enabled && tm?.phone_number) return "textmagic";
  return "twilio";
}

/** Send an SMS from a practice. Throws SmsError on failure. */
export async function sendSms(
  practice: SmsPractice,
  to: string,
  body: string,
): Promise<SmsResult> {
  const provider = resolveProvider(practice);
  if (provider === "textmagic") {
    return sendViaTextMagic(practice, to, body);
  }
  return sendViaTwilio(practice, to, body);
}

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

async function sendViaTwilio(
  practice: SmsPractice,
  to: string,
  body: string,
): Promise<SmsResult> {
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    throw new SmsError("Twilio credentials not configured", "twilio", 500);
  }

  const params: Record<string, string> = { To: to, Body: body };
  if (practice.messaging_service_sid) {
    params.MessagingServiceSid = practice.messaging_service_sid;
  } else if (practice.twilio_sms_number) {
    params.From = practice.twilio_sms_number;
  } else {
    throw new SmsError(
      "Twilio SMS not configured for this practice (no Messaging Service or SMS number).",
      "twilio",
      400,
    );
  }

  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    },
  );
  const result = await res.json();

  if (!res.ok) {
    throw new SmsError(
      result.message || "Twilio send failed",
      "twilio",
      res.status,
      result.code,
    );
  }

  return {
    provider: "twilio",
    messageId: result.sid,
    status: result.status,
    from: result.from || params.From || practice.name,
    to: result.to,
  };
}

// ---------------------------------------------------------------------------
// TextMagic (REST API v2)
//   Docs: https://docs.textmagic.com/
//   Auth: X-TM-Username + X-TM-Key headers
//   Send endpoint: POST https://rest.textmagic.com/api/v2/messages
// ---------------------------------------------------------------------------

async function sendViaTextMagic(
  practice: SmsPractice,
  to: string,
  body: string,
): Promise<SmsResult> {
  if (!TEXTMAGIC_USERNAME || !TEXTMAGIC_API_KEY) {
    throw new SmsError("TextMagic credentials not configured", "textmagic", 500);
  }

  const tm = practice.integrations?.textmagic;
  if (!tm?.phone_number) {
    throw new SmsError(
      "TextMagic not configured for this practice (missing phone_number).",
      "textmagic",
      400,
    );
  }

  // TextMagic expects phone numbers without the leading + (E.164 digits only).
  const phones = to.replace(/^\+/, "");
  const from = (tm.sender_id || tm.phone_number).replace(/^\+/, "");

  const params = new URLSearchParams({
    text: body,
    phones,
    from,
  });

  const res = await fetch("https://rest.textmagic.com/api/v2/messages", {
    method: "POST",
    headers: {
      "X-TM-Username": TEXTMAGIC_USERNAME,
      "X-TM-Key": TEXTMAGIC_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  // TextMagic returns 201 Created on success with JSON body { id, href, type, sessionId, bulkId, messageId, ... }
  const text = await res.text();
  let result: Record<string, unknown> = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON response
  }

  if (!res.ok) {
    const msg = (result.message as string) || text || "TextMagic send failed";
    throw new SmsError(msg, "textmagic", res.status, result.code as number);
  }

  const messageId = String(
    result.messageId ?? result.id ?? result.sessionId ?? "",
  );

  return {
    provider: "textmagic",
    messageId,
    status: String(result.status ?? "queued"),
    from,
    to,
  };
}
