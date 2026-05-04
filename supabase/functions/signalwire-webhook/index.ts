/**
 * Purpose:
 *   Inbound SMS webhook for SignalWire. SignalWire's compatibility API posts
 *   the same form-encoded payload Twilio does (From / To / Body / MessageSid),
 *   so this mirrors twilio-sms-webhook but resolves the practice via the
 *   integrations.signalwire.phone_number field.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/match-contact.ts
 *   - _shared/practice-context.ts (loadPractice)
 *   - _shared/conversation.ts (appendToEnquiry, appendReplyToEnquiry)
 *   - _shared/ai-reply.ts
 *   - _shared/sms.ts
 *
 * SignalWire dashboard setup:
 *   On the purchased phone number → "Messaging" → "When a message comes in":
 *     POST https://amxcposgqlmgapzoopze.supabase.co/functions/v1/signalwire-webhook
 *     Format: x-www-form-urlencoded
 *
 * Changes:
 *   2026-04-27: Initial — SignalWire SMS as a Twilio backup with proper
 *               UK MNO termination.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findOrCreateContact, normalizePhone } from "../_shared/match-contact.ts";
import {
  buildPracticeContext,
  getConversationHistory,
  loadPractice,
} from "../_shared/practice-context.ts";
import { appendReplyToEnquiry, appendToEnquiry } from "../_shared/conversation.ts";
import { getAiReply } from "../_shared/ai-reply.ts";
import { sendSms } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function twiml(message?: string): Response {
  const xml = message
    ? `<Response><Message>${message}</Message></Response>`
    : `<Response/>`;
  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

function parseFormData(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return params;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return twiml();

  try {
    const rawBody = await req.text();
    const form = parseFormData(rawBody);
    const rawFrom = form.From || "";
    const rawTo = form.To || "";
    const text = form.Body || "";
    const messageSid = form.MessageSid || form.SmsMessageSid || null;

    if (!rawFrom || !rawTo || !text) {
      console.warn("[SIGNALWIRE WEBHOOK] Missing fields:", JSON.stringify(form));
      return twiml();
    }

    const from = normalizePhone(rawFrom);
    const to = normalizePhone(rawTo);

    // Self-text guard — same loop protection used in textmagic-webhook.
    if (from && from === to) {
      console.log(`[SIGNALWIRE WEBHOOK] Ignoring self-text on ${to}`);
      return twiml();
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const practice = await loadPractice(db, { signalwireNumber: to });
    if (!practice) {
      console.warn(`[SIGNALWIRE WEBHOOK] No practice for number ${to}`);
      return twiml();
    }

    const integrations = practice.integrations || {};
    const sw = integrations.signalwire || {};
    if (sw.enabled === false) {
      console.log(`[SIGNALWIRE WEBHOOK] SignalWire disabled for ${practice.name}`);
      return twiml();
    }

    const contact = await findOrCreateContact(db, {
      practiceId: practice.id,
      phone: from,
      source: "sms",
    });
    if (!contact) {
      console.error(`[SIGNALWIRE WEBHOOK] Failed to create contact for ${from}`);
      return twiml();
    }

    const { enquiryId } = await appendToEnquiry(db, {
      practiceId: practice.id,
      contactId: contact.id,
      patientName: contact.name || "Unknown",
      channel: "sms",
      message: text,
      role: "patient",
      providerMessageId: messageSid,
    });

    await db
      .from("conversations")
      .insert({
        practice_id: practice.id,
        contact_id: contact.id,
        channel: "sms",
        status: "active",
        caller_name: contact.name,
      });

    const aiEnabled = sw.ai_reply_enabled !== false;
    if (aiEnabled) {
      const practiceContext = buildPracticeContext(practice);
      const history = await getConversationHistory(db, contact.id, practice.id);
      const aiReply = await getAiReply({
        agentId: practice.elevenlabs_agent_id,
        message: text,
        practiceContext,
        conversationHistory: history,
        contactName: contact.name || "Unknown",
        contactPhone: from,
        channel: "sms",
        db,
        practiceId: practice.id,
      });

      try {
        const sent = await sendSms(practice, from, aiReply);
        console.log(
          `[SIGNALWIRE WEBHOOK] Replied via ${sent.provider} | id=${sent.messageId} | status=${sent.status}`,
        );
        await appendReplyToEnquiry(db, enquiryId, aiReply, "sms");
      } catch (e) {
        console.error("[SIGNALWIRE WEBHOOK] Failed to send AI reply:", e);
      }
    }

    return twiml();
  } catch (err) {
    console.error("[SIGNALWIRE WEBHOOK ERROR]", err);
    return twiml();
  }
});
