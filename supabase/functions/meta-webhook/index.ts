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
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "pathir_meta_verify_2026";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";

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

/**
 * Get an AI response from ElevenLabs Conversational AI (text mode).
 * Falls back to a static reply if the API is unavailable or unconfigured.
 */
async function getAIResponse(
  agentId: string,
  message: string,
  // deno-lint-ignore no-explicit-any
  practiceContext: Record<string, any>,
  conversationHistory: string | null,
  contactName: string,
  channel: string,
): Promise<string> {
  if (!ELEVENLABS_API_KEY || !agentId) {
    // Fallback: no API key or agent configured
    const greeting = contactName && contactName !== "Unknown" ? `Hi ${contactName.split(" ")[0]}! ` : "Hi! ";
    return `${greeting}Thanks for your message. The team at ${practiceContext.practice_name} will get back to you shortly.`;
  }

  try {
    // Build a system context message for the text conversation
    const contextParts = [
      `You are responding to a ${channel === "facebook" ? "Facebook Messenger" : "Instagram DM"} message.`,
      `Practice: ${practiceContext.practice_name}`,
      practiceContext.practice_phone ? `Phone: ${practiceContext.practice_phone}` : null,
      practiceContext.practice_website ? `Website: ${practiceContext.practice_website}` : null,
      practiceContext.opening_hours ? `Hours:\n${practiceContext.opening_hours}` : null,
      practiceContext.clinic_guidelines ? `Guidelines: ${practiceContext.clinic_guidelines}` : null,
      practiceContext.agent_tone ? `Tone: ${practiceContext.agent_tone}` : null,
      practiceContext.practitioners?.length > 0
        // deno-lint-ignore no-explicit-any
        ? `Team:\n${practiceContext.practitioners.map((p: any) => `- ${p.name}${p.credentials ? ` (${p.credentials})` : ""}${p.bio ? `: ${p.bio}` : ""}`).join("\n")}`
        : null,
      practiceContext.prices?.length > 0
        // deno-lint-ignore no-explicit-any
        ? `Prices:\n${practiceContext.prices.map((p: any) => `- ${p.service}: ${p.price}`).join("\n")}`
        : null,
      conversationHistory ? `Previous interactions:\n${conversationHistory}` : null,
      contactName !== "Unknown" ? `Patient name: ${contactName}` : null,
    ].filter(Boolean);

    // Use ElevenLabs text endpoint
    // The agent already has the system prompt and tool config from provision-practice
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/text`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          agent_id: agentId,
          text: message,
          context: {
            // Pass practice context so the agent has full knowledge
            overrides: {
              system_prompt_append: contextParts.join("\n\n"),
            },
          },
        }),
      },
    );

    if (res.ok) {
      const data = await res.json();
      // ElevenLabs text API returns the agent's response
      const aiReply = data.response || data.text || data.message;
      if (aiReply && typeof aiReply === "string" && aiReply.trim().length > 0) {
        return aiReply.trim();
      }
    } else {
      const errText = await res.text();
      console.warn("[META WEBHOOK] ElevenLabs text API error:", res.status, errText);
    }
  } catch (e) {
    console.warn("[META WEBHOOK] ElevenLabs text call failed:", e);
  }

  // Fallback if AI fails
  const greeting = contactName && contactName !== "Unknown" ? `Hi ${contactName.split(" ")[0]}! ` : "Hi! ";
  return `${greeting}Thanks for your message. The team at ${practiceContext.practice_name} will get back to you shortly.`;
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

          const aiReply = await getAIResponse(
            practice.elevenlabs_agent_id,
            messageText,
            practiceContext,
            history,
            contact.name || "Unknown",
            channel,
          );

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
