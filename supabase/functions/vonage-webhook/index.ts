/**
 * Purpose:
 *   Inbound SMS webhook for Vonage (formerly Nexmo). Vonage's legacy SMS
 *   API posts URL-encoded form data with fields msisdn / to / text /
 *   messageId. This mirrors the Twilio + SignalWire webhook handlers,
 *   resolving the practice via integrations.vonage.phone_number.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/match-contact.ts (findOrCreateContact, normalizePhone)
 *   - _shared/practice-context.ts (loadPractice)
 *   - _shared/conversation.ts (appendToEnquiry, appendReplyToEnquiry)
 *   - _shared/ai-reply.ts (getAiReply)
 *   - _shared/sms.ts (sendSms — replies via the same Vonage account)
 *
 * Vonage dashboard setup:
 *   API Settings → Inbound webhooks → URL:
 *     https://amxcposgqlmgapzoopze.supabase.co/functions/v1/vonage-webhook
 *   API type: SMS API (legacy) for the simplest auth path
 *
 * Changes:
 *   2026-04-27: Initial — Vonage as a UK-MNO-routed SMS backup.
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

/** Parse Vonage's form-encoded body OR JSON body (depending on dashboard config). */
async function parsePayload(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  const out: Record<string, string> = {};

  // GET delivery — Vonage sometimes uses GET with query params for SMS API.
  if (req.method === "GET") {
    const u = new URL(req.url);
    for (const [k, v] of u.searchParams.entries()) out[k] = v;
    return out;
  }

  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }

  try {
    const json = await req.json();
    for (const k of Object.keys(json || {})) out[k] = String(json[k]);
  } catch {
    // empty/non-json
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("OK", { status: 200 });
  }

  try {
    const form = await parsePayload(req);

    // Vonage SMS API field names: msisdn (sender), to (our number), text, messageId
    const rawFrom = form.msisdn || form.from || "";
    const rawTo   = form.to     || "";
    const text    = form.text   || form.body || "";
    const messageSid = form.messageId || form["message-id"] || form.id || null;

    if (!rawFrom || !rawTo || !text) {
      console.warn("[VONAGE WEBHOOK] Missing fields:", JSON.stringify(form));
      return new Response("OK", { status: 200 });
    }

    const from = normalizePhone(rawFrom);
    const to   = normalizePhone(rawTo);

    if (from && from === to) {
      console.log(`[VONAGE WEBHOOK] Ignoring self-text on ${to}`);
      return new Response("OK", { status: 200 });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const practice = await loadPractice(db, { vonageNumber: to });
    if (!practice) {
      console.warn(`[VONAGE WEBHOOK] No practice for number ${to}`);
      return new Response("OK", { status: 200 });
    }

    const integrations = practice.integrations || {};
    const vg = integrations.vonage || {};
    if (vg.enabled === false) {
      console.log(`[VONAGE WEBHOOK] Vonage disabled for ${practice.name}`);
      return new Response("OK", { status: 200 });
    }

    const contact = await findOrCreateContact(db, {
      practiceId: practice.id,
      phone: from,
      source: "sms",
    });
    if (!contact) {
      console.error(`[VONAGE WEBHOOK] Failed to create contact for ${from}`);
      return new Response("OK", { status: 200 });
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

    const aiEnabled = vg.ai_reply_enabled !== false;
    if (aiEnabled) {
      const practiceContext = buildPracticeContext(practice);
      const history = await getConversationHistory(db, contact.id, practice.id);
      const aiReply = await getAiReply({
        agentId: practice.elevenlabs_agent_id,
        message: text,
        practiceContext,
        conversationHistory: history,
        contactName: contact.name || "Unknown",
        channel: "sms",
        db,
        practiceId: practice.id,
      });

      try {
        const sent = await sendSms(practice, from, aiReply);
        console.log(
          `[VONAGE WEBHOOK] Replied via ${sent.provider} | id=${sent.messageId} | status=${sent.status}`,
        );
        await appendReplyToEnquiry(db, enquiryId, aiReply, "sms");
      } catch (e) {
        console.error("[VONAGE WEBHOOK] Failed to send AI reply:", e);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[VONAGE WEBHOOK ERROR]", err);
    return new Response("OK", { status: 200 });
  }
});
