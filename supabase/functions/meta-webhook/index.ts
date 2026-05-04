/**
 * Purpose:
 *   Handles incoming Facebook Messenger + Instagram DM messages via Meta webhook.
 *   Uses ElevenLabs Conversational AI (text mode) for intelligent responses —
 *   same AI brain as phone calls and web chat.
 *   Creates contacts, conversations, and enquiries — same DB flow as all channels.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/match-contact.ts (findOrCreateContact)
 *   - _shared/practice-context.ts (loadPractice, buildPracticeContext, getConversationHistory)
 *   - _shared/conversation.ts (appendToEnquiry, appendReplyToEnquiry)
 *   - _shared/cors.ts
 *
 * Webhook setup:
 *   1. In Meta App Dashboard -> Messenger -> Webhooks -> set callback URL to:
 *      https://amxcposgqlmgapzoopze.supabase.co/functions/v1/meta-webhook
 *   2. Set Verify Token to match META_VERIFY_TOKEN secret
 *   3. Subscribe to: messages, messaging_postbacks
 *
 * Changes:
 *   2026-04-10: Major rewrite — ElevenLabs text API for AI responses,
 *               shared modules for contact/context/conversation, full two-way AI.
 *   2026-03-12: Initial creation — FB Messenger + Instagram DM support.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findOrCreateContact } from "../_shared/match-contact.ts";
import { loadPractice, buildPracticeContext, getConversationHistory } from "../_shared/practice-context.ts";
import { appendToEnquiry, appendReplyToEnquiry } from "../_shared/conversation.ts";
import { getAiReply } from "../_shared/ai-reply.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "pathir_meta_verify_2026";

const GRAPH_API = "https://graph.facebook.com/v19.0";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send a text reply via Meta Graph API */
async function sendMetaReply(
  recipientId: string,
  text: string,
  accessToken: string,
) {
  const res = await fetch(
    `${GRAPH_API}/me/messages?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[META WEBHOOK] Failed to send reply:", err);
  }
}

/** Fetch sender name from Meta Graph API */
async function getSenderName(senderId: string, accessToken: string): Promise<string> {
  try {
    const res = await fetch(
      `${GRAPH_API}/${senderId}?fields=name&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (res.ok) {
      const profile = await res.json();
      return profile.name || "Unknown";
    }
  } catch {
    // Name lookup failed — not critical
  }
  return "Unknown";
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Webhook verification (GET) ──
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = url.searchParams.get("hub.verify_token");

    if (mode === "subscribe" && verifyToken === META_VERIFY_TOKEN) {
      console.log("[META WEBHOOK] Verification successful");
      return new Response(challenge || "", { status: 200 });
    }

    return new Response("Forbidden", { status: 403 });
  }

  // ── Incoming messages (POST) ──
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Meta requires 200 within 20 seconds or it retries
  try {
    const body = await req.json();
    const objectType = body.object; // "page" or "instagram"

    if (objectType !== "page" && objectType !== "instagram") {
      return new Response("OK", { status: 200 });
    }

    const channel: "facebook" | "instagram" = objectType === "page" ? "facebook" : "instagram";
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    for (const entry of body.entry || []) {
      const metaId = entry.id; // Page ID or IG Account ID

      // Look up the practice that owns this Page/IG account
      const practice = await loadPractice(db, {
        ...(channel === "facebook"
          ? { facebookPageId: metaId }
          : { instagramBusinessId: metaId }),
      });

      if (!practice) {
        console.warn(`[META WEBHOOK] No practice found for ${channel} ID: ${metaId}`);
        continue;
      }

      const integrations = practice.integrations || {};
      const accessToken = channel === "facebook"
        ? integrations.facebook_access_token
        : integrations.instagram_access_token;

      // Check channel is enabled
      const enabledKey = channel === "facebook" ? "facebook_enabled" : "instagram_enabled";
      if (!integrations[enabledKey]) {
        console.log(`[META WEBHOOK] ${channel} is disabled for practice ${practice.id}`);
        continue;
      }

      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        // Skip if no sender or no text (reactions, read receipts, etc.)
        if (!senderId || !messageText) continue;

        // Skip echo messages (sent by the page itself)
        if (event.message?.is_echo) continue;

        console.log(`[META WEBHOOK] ${channel} message from ${senderId}: ${messageText.slice(0, 100)}`);

        // ── Find or create contact using shared module ──
        const metaIdField = channel === "facebook" ? "facebookPsid" : "instagramId";
        let senderName = "Unknown";
        if (accessToken) {
          senderName = await getSenderName(senderId, accessToken);
        }

        const contact = await findOrCreateContact(db, {
          practiceId: practice.id,
          name: senderName,
          source: channel,
          [metaIdField]: senderId,
        });

        if (!contact) {
          console.error(`[META WEBHOOK] Failed to create contact for sender ${senderId}`);
          continue;
        }

        // ── Store patient message in enquiry ──
        const { enquiryId } = await appendToEnquiry(db, {
          practiceId: practice.id,
          contactId: contact.id,
          patientName: contact.name || "Unknown",
          channel,
          message: messageText,
          role: "patient",
        });

        // ── Create conversation record ──
        const { data: conv } = await db
          .from("conversations")
          .insert({
            practice_id: practice.id,
            contact_id: contact.id,
            channel,
            status: "active",
            caller_name: contact.name,
          })
          .select("id")
          .single();

        // ── Get AI response ──
        if (accessToken) {
          const practiceContext = buildPracticeContext(practice);
          const history = await getConversationHistory(db, contact.id, practice.id);

          const aiReply = await getAiReply({
            agentId: practice.elevenlabs_agent_id,
            message: messageText,
            practiceContext,
            conversationHistory: history,
            contactName: contact.name || "Unknown",
            /* Meta channels don't always have a phone (the contact is
               identified by FB PSID / IG ID). Pass it through if our
               cross-channel matcher backfilled it from a prior call. */
            contactPhone: contact.phone || null,
            channel,
            db,
            practiceId: practice.id,
          });

          // Send the AI response back via Meta
          await sendMetaReply(senderId, aiReply, accessToken);

          // Store AI reply in enquiry conversation
          await appendReplyToEnquiry(db, enquiryId, aiReply, channel);

          // Update conversation record
          if (conv) {
            await db
              .from("conversations")
              .update({
                summary: `${channel === "facebook" ? "Facebook" : "Instagram"} message: "${messageText.slice(0, 80)}"`,
                outcome: "ai_handled",
                status: "completed",
              })
              .eq("id", conv.id);
          }
        }
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[META WEBHOOK ERROR]", err);
    // Always return 200 to Meta to prevent retries on our errors
    return new Response("OK", { status: 200 });
  }
});
