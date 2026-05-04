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
import { appendReplyToEnquiry, appendToEnquiry } from "../_shared/conversation.ts";
import {
  buildPracticeContext,
  getConversationHistory,
  loadPractice,
} from "../_shared/practice-context.ts";
import { getAiReply } from "../_shared/ai-reply.ts";
import { sendSms } from "../_shared/sms.ts";

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
    const messagingServiceSid =
      form.MessagingServiceSid || form.MessagingServiceSID || null;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve the practice in priority order:
    //   1. by the receiving number against twilio_phone_number (legacy single-number setup)
    //   2. by the receiving number against twilio_sms_number (separate SMS line)
    //   3. by the MessagingServiceSid the inbound came in through (modern setup
    //      where the SMS-capable Mobile number lives only inside a Messaging
    //      Service, not on the practice row)
    let practice: { id: string; name: string; integrations: unknown; twilio_phone_number: string | null } | null = null;

    {
      const { data } = await db
        .from("practices")
        .select("id, name, integrations, twilio_phone_number")
        .eq("twilio_phone_number", to)
        .maybeSingle();
      practice = data ?? null;
    }
    if (!practice) {
      const { data } = await db
        .from("practices")
        .select("id, name, integrations, twilio_phone_number")
        .eq("twilio_sms_number", to)
        .maybeSingle();
      practice = data ?? null;
    }
    if (!practice && messagingServiceSid) {
      const { data } = await db
        .from("practices")
        .select("id, name, integrations, twilio_phone_number")
        .eq("messaging_service_sid", messagingServiceSid)
        .maybeSingle();
      practice = data ?? null;
    }

    if (!practice) {
      console.warn(
        `[TWILIO SMS] No practice for number ${to} (mgsid=${messagingServiceSid})`,
      );
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

    // Open / update a conversation row so the dashboard sees the live thread.
    await db
      .from("conversations")
      .insert({
        practice_id: practice.id,
        contact_id: contact.id,
        channel: "sms",
        status: "active",
        caller_name: contact.name,
      });

    // AI auto-reply — same brain as Hannah/Poppy on every other channel.
    // Pulls full practice context (services, prices, practitioners, hours,
    // locations) so the reply is tailored to the practice.
    // deno-lint-ignore no-explicit-any
    const integrations = (practice as any).integrations || {};
    const aiEnabled = integrations.sms_ai_reply_enabled !== false;
    if (aiEnabled) {
      const fullPractice = await loadPractice(db, { practiceId: practice.id });
      if (fullPractice) {
        const practiceContext = buildPracticeContext(fullPractice);
        const history = await getConversationHistory(db, contact.id, practice.id);
        try {
          const aiReply = await getAiReply({
            agentId: fullPractice.elevenlabs_agent_id,
            message: body,
            practiceContext,
            conversationHistory: history,
            contactName: contact.name || "Unknown",
            contactPhone: from,
            channel: "sms",
            db,
            practiceId: practice.id,
          });
          const sent = await sendSms(fullPractice, from, aiReply);
          console.log(
            `[TWILIO SMS] AI replied via ${sent.provider} | id=${sent.messageId} | status=${sent.status}`,
          );
          await appendReplyToEnquiry(db, enquiryId, aiReply, "sms");
        } catch (e) {
          console.error("[TWILIO SMS] AI auto-reply failed:", e);
        }
      }
    }

    // Empty TwiML — the AI reply (if any) was just sent via the API path
    // above. Avoid double-replying via TwiML <Message>.
    return twiml();
  } catch (err) {
    console.error("[TWILIO SMS ERROR]", err);
    return twiml();
  }
});
