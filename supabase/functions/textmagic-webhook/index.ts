/**
 * Purpose:
 *   Handles incoming SMS messages via TextMagic webhook. Looks up the practice
 *   that owns the receiving TextMagic number, records the message, and replies
 *   using the same ElevenLabs AI brain as phone calls and Meta messages.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/match-contact.ts (findOrCreateContact)
 *   - _shared/practice-context.ts (loadPractice, buildPracticeContext, getConversationHistory)
 *   - _shared/conversation.ts (appendToEnquiry, appendReplyToEnquiry)
 *   - _shared/ai-reply.ts (getAiReply)
 *   - _shared/sms.ts (sendSms)
 *
 * TextMagic setup:
 *   Callback URL (inbound messages):
 *     https://amxcposgqlmgapzoopze.supabase.co/functions/v1/textmagic-webhook
 *   Callback format: multipart/form-data
 *
 * Changes:
 *   2026-04-24: Initial — two-way SMS via TextMagic with AI auto-reply.
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
const PATHIR_TRIAL_SMS_NUMBER = Deno.env.get("PATHIR_TRIAL_SMS_NUMBER") || "+447418341716";

/**
 * Parse TextMagic's webhook payload. TextMagic is configured to use
 * multipart/form-data, but will fall back to urlencoded in some setups — handle
 * both so a future format change doesn't silently drop messages.
 */
async function parsePayload(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  const out: Record<string, string> = {};

  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }

  // JSON fallback (some clients may post this)
  try {
    const json = await req.json();
    for (const k of Object.keys(json || {})) {
      out[k] = String(json[k]);
    }
  } catch {
    // Empty body or non-JSON — return whatever we have
  }
  return out;
}

/** TextMagic inbound payloads have varied field names across versions — handle both. */
function extractMessage(form: Record<string, string>): {
  from: string;
  to: string;
  text: string;
  messageId: string;
} {
  return {
    from: form.sender || form.from || form.phone || "",
    to: form.receiver || form.to || form.recipient || "",
    text: form.text || form.message || form.body || "",
    messageId: form.messageId || form.id || form.reference_id || "",
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const form = await parsePayload(req);
    const { from: rawFrom, to: rawTo, text, messageId } = extractMessage(form);

    if (!rawFrom || !rawTo || !text) {
      console.warn("[TEXTMAGIC WEBHOOK] Missing fields. Raw payload:", JSON.stringify(form));
      return new Response("OK", { status: 200 });
    }

    const from = normalizePhone(rawFrom);
    const to = normalizePhone(rawTo);

    // Self-text guard: if sender and receiver are the same number, the AI
    // would reply to itself and create an infinite loop (learned the hard
    // way during routing-verification loopback). Log and bail before any
    // DB writes or AI calls.
    if (from && from === to) {
      console.log(`[TEXTMAGIC WEBHOOK] Ignoring self-text on ${to}`);
      return new Response("OK", { status: 200 });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    /* Trial-route lookup: when a brand-new clinic is testing during
       onboarding, the inbound is on the platform's shared TextMagic number
       and we route by the sender's mobile (registered by intro-test-sms).
       This is checked BEFORE recipient-based lookup so the platform number
       can be shared across many trial signups without colliding with any
       practice that already owns it. */
    // deno-lint-ignore no-explicit-any
    let practice: any = null;
    if (normalizePhone(PATHIR_TRIAL_SMS_NUMBER) === to) {
      const { data: route } = await db
        .from("sms_trial_routes")
        .select("practice_id")
        .eq("user_phone", from)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (route?.practice_id) {
        const routed = await loadPractice(db, { practiceId: route.practice_id });
        if (routed) {
          /* Inject the trial-mode SMS config so the AI's reply also goes
             through the shared platform number. We do not persist this
             onto the practice row — when they connect their own provider
             from Settings, the normal sms.ts resolver picks it up. */
          practice = {
            ...routed,
            integrations: {
              ...(routed.integrations || {}),
              sms_provider: "textmagic",
              textmagic: {
                ...(routed.integrations?.textmagic || {}),
                enabled: true,
                phone_number: PATHIR_TRIAL_SMS_NUMBER,
                sender_id: PATHIR_TRIAL_SMS_NUMBER,
                ai_reply_enabled: true,
              },
            },
          };
          console.log(`[TEXTMAGIC WEBHOOK] Trial route matched: ${from} -> ${routed.name}`);
        }
      }
    }

    // Recipient-based lookup for production traffic.
    if (!practice) {
      practice = await loadPractice(db, { textmagicNumber: to });
    }

    if (!practice) {
      console.warn(`[TEXTMAGIC WEBHOOK] No practice for number ${to}`);
      return new Response("OK", { status: 200 });
    }

    const integrations = practice.integrations || {};
    const tm = integrations.textmagic || {};

    /* Honour the master SMS toggle (integrations.sms_enabled). The
       twilio-sms-webhook checked it; this one didn't — meaning a practice
       that flipped SMS off in the dashboard was still being replied to on
       TextMagic-routed inbound. Same behaviour both webhooks now. */
    if (integrations.sms_enabled === false) {
      console.log(`[TEXTMAGIC WEBHOOK] SMS toggled off for ${practice.name}`);
      return new Response("OK", { status: 200 });
    }

    if (tm.enabled === false) {
      console.log(`[TEXTMAGIC WEBHOOK] TextMagic disabled for ${practice.name}`);
      return new Response("OK", { status: 200 });
    }

    console.log(
      `[TEXTMAGIC WEBHOOK] ${practice.name} | from=${from} | id=${messageId} | text="${text.slice(0, 80)}"`,
    );

    // Contact — phone-based, shared cross-channel matcher. Passing no name
    // lets findOrCreateContact default to "Unknown" for new contacts and
    // keep the existing name (e.g. from a prior phone call) for returnees.
    const contact = await findOrCreateContact(db, {
      practiceId: practice.id,
      phone: from,
      source: "sms",
    });

    if (!contact) {
      console.error(`[TEXTMAGIC WEBHOOK] Failed to create contact for ${from}`);
      return new Response("OK", { status: 200 });
    }

    // Record the patient's message.
    const { enquiryId } = await appendToEnquiry(db, {
      practiceId: practice.id,
      contactId: contact.id,
      patientName: contact.name || "Unknown",
      channel: "sms",
      message: text,
      role: "patient",
    });

    // Open a conversation row for dashboard display.
    const { data: conv } = await db
      .from("conversations")
      .insert({
        practice_id: practice.id,
        contact_id: contact.id,
        channel: "sms",
        status: "active",
        caller_name: contact.name,
      })
      .select("id")
      .single();

    // AI auto-reply unless the practice has opted out.
    const aiEnabled = tm.ai_reply_enabled !== false;
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
          `[TEXTMAGIC WEBHOOK] Replied via ${sent.provider} | id=${sent.messageId} | status=${sent.status}`,
        );
        await appendReplyToEnquiry(db, enquiryId, aiReply, "sms");

        if (conv) {
          await db
            .from("conversations")
            .update({
              summary: `SMS: "${text.slice(0, 80)}"`,
              outcome: "ai_handled",
              status: "completed",
            })
            .eq("id", conv.id);
        }
      } catch (e) {
        console.error("[TEXTMAGIC WEBHOOK] Failed to send AI reply:", e);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[TEXTMAGIC WEBHOOK ERROR]", err);
    // Always 200 so TextMagic doesn't retry on our errors.
    return new Response("OK", { status: 200 });
  }
});
