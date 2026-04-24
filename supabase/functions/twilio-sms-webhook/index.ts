/**
 * Purpose:
 *   Handles incoming SMS via Twilio webhook. Looks up the practice by the
 *   receiving Twilio number, records contact + enquiry + message rows, and
 *   replies via TwiML based on the practice's SMS setting.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/match-contact.ts (findOrCreateContact)
 *   - _shared/conversation.ts (appendToEnquiry)
 *
 * Used by:
 *   - Twilio SMS webhook (external POST from Twilio on incoming SMS)
 *
 * Changes:
 *   2026-04-24: Drop inline read-modify-write onto the conversation JSONB;
 *               use shared appendToEnquiry so messages land in the
 *               enquiry_messages table like every other channel.
 *   2026-03-09: Ported from api/twilio-sms-webhook.js to Deno Edge Function.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findOrCreateContact } from "../_shared/match-contact.ts";
import { appendToEnquiry } from "../_shared/conversation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Return a TwiML XML response with an optional message. */
function twiml(message?: string): Response {
  const xml = message
    ? `<Response><Message>${message}</Message></Response>`
    : `<Response/>`;
  return new Response(xml, {
    headers: { "Content-Type": "text/xml" },
  });
}

/** Parse application/x-www-form-urlencoded body (Twilio sends form data). */
function parseFormData(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [key, value] = pair.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "");
  }
  return params;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return twiml();
  }

  try {
    const rawBody = await req.text();
    const form = parseFormData(rawBody);
    const from = form.From || "";
    const to = form.To || "";
    const body = form.Body || "";
    const messageSid = form.MessageSid || form.SmsMessageSid || null;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: practice } = await db
      .from("practices")
      .select("id, name, integrations, twilio_phone_number")
      .eq("twilio_phone_number", to)
      .single();

    if (!practice) {
      console.warn(`[TWILIO SMS] No practice for number ${to}`);
      return twiml("This number is not currently active.");
    }

    // deno-lint-ignore no-explicit-any
    const smsEnabled = (practice.integrations as any)?.sms_enabled !== false;
    if (!smsEnabled) {
      return twiml(
        `Thanks for your message. This number doesn't receive texts — please call us on ${practice.twilio_phone_number} and our team will help you.`,
      );
    }

    const contact = await findOrCreateContact(db, {
      practiceId: practice.id,
      phone: from,
      source: "sms",
    });

    if (!contact) {
      console.error(`[TWILIO SMS] Failed to create contact for ${from}`);
      return twiml(`Thanks for your message! The team at ${practice.name} will get back to you shortly.`);
    }

    const { enquiryId, isNew } = await appendToEnquiry(db, {
      practiceId: practice.id,
      contactId: contact.id,
      patientName: contact.name || "Unknown",
      channel: "sms",
      message: body,
      role: "patient",
      providerMessageId: messageSid,
    });

    console.log(
      `[TWILIO SMS] ${practice.name} | from=${from} | enquiry=${enquiryId} ${isNew ? "(new)" : "(existing)"}`,
    );

    return twiml(`Thanks for your message! The team at ${practice.name} will get back to you shortly.`);
  } catch (err) {
    console.error("[TWILIO SMS ERROR]", err);
    return twiml("Thanks for your message. We'll get back to you soon.");
  }
});
