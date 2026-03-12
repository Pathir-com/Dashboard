/**
 * Purpose:
 *   Handles incoming Facebook Messenger + Instagram DM messages via Meta webhook.
 *   Creates contacts, conversations, and enquiries — same DB flow as phone/chat/SMS.
 *   Sends an auto-reply acknowledging the message.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/match-contact.ts (findOrCreateContact)
 *   - _shared/cors.ts
 *
 * Webhook setup:
 *   1. In Meta App Dashboard → Messenger → Webhooks → set callback URL to:
 *      https://amxcposgqlmgapzoopze.supabase.co/functions/v1/meta-webhook
 *   2. Set Verify Token to match META_VERIFY_TOKEN secret
 *   3. Subscribe to: messages, messaging_postbacks
 *
 * Changes:
 *   2026-03-12: Initial creation — FB Messenger + Instagram DM support
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findOrCreateContact } from "../_shared/match-contact.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "pathir_meta_verify_2026";

const GRAPH_API = "https://graph.facebook.com/v19.0";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up which practice owns this Page ID or IG Account ID via integrations JSONB */
async function findPracticeByMetaId(
  db: ReturnType<typeof createClient>,
  metaId: string,
  channel: "facebook" | "instagram",
) {
  const field = channel === "facebook" ? "facebook_page_id" : "instagram_business_id";
  const tokenField = channel === "facebook" ? "facebook_access_token" : "instagram_access_token";

  // Query practices whose integrations JSONB contains the matching ID
  const { data: practices } = await db
    .from("practices")
    .select("id, name, email, integrations")
    .filter(`integrations->${field}`, "eq", metaId);

  if (!practices || practices.length === 0) return null;

  const practice = practices[0];
  const integrations = (practice.integrations || {}) as Record<string, unknown>;
  const accessToken = integrations[tokenField] as string | undefined;

  return {
    id: practice.id,
    name: practice.name,
    email: practice.email,
    accessToken: accessToken || null,
    integrations,
  };
}

/** Send a text reply via Meta Graph API */
async function sendMetaReply(
  recipientId: string,
  text: string,
  accessToken: string,
  channel: "facebook" | "instagram",
) {
  const endpoint = channel === "facebook"
    ? `${GRAPH_API}/me/messages`
    : `${GRAPH_API}/me/messages`;

  const res = await fetch(`${endpoint}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[META WEBHOOK] Failed to send reply (${channel}):`, err);
  }
}

/** Get conversation history for a contact across all channels */
async function getConversationContext(
  db: ReturnType<typeof createClient>,
  contactId: string,
  practiceId: string,
) {
  const { data: conversations } = await db
    .from("conversations")
    .select("channel, outcome, summary, started_at")
    .eq("contact_id", contactId)
    .eq("practice_id", practiceId)
    .order("started_at", { ascending: false })
    .limit(5);

  if (!conversations || conversations.length === 0) return null;

  const lines = conversations.map((c) => {
    const date = new Date(c.started_at).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short",
    });
    const channelLabel: Record<string, string> = {
      phone: "Phone call", web_chat: "Web chat", sms: "Text",
      facebook: "Facebook Messenger", instagram: "Instagram DM",
    };
    const via = channelLabel[c.channel] || c.channel;
    return `- ${date} (${via}): ${c.summary || "No summary"}`;
  });

  return lines.join("\n");
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
  // Meta sends: GET ?hub.mode=subscribe&hub.challenge=xxx&hub.verify_token=yyy
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
  // Process in background after sending 200
  try {
    const body = await req.json();
    const objectType = body.object; // "page" or "instagram"

    if (objectType !== "page" && objectType !== "instagram") {
      return new Response("OK", { status: 200 });
    }

    const channel: "facebook" | "instagram" = objectType === "page" ? "facebook" : "instagram";
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    for (const entry of (body.entry || [])) {
      const metaId = entry.id; // Page ID or IG Account ID

      // Look up the practice that owns this Page/IG account
      const practice = await findPracticeByMetaId(db, metaId, channel);
      if (!practice) {
        console.warn(`[META WEBHOOK] No practice found for ${channel} ID: ${metaId}`);
        continue;
      }

      for (const event of (entry.messaging || [])) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        // Skip if no sender or no text (e.g. reactions, read receipts)
        if (!senderId || !messageText) continue;

        // Skip echo messages (sent by the page itself)
        if (event.message?.is_echo) continue;

        console.log(`[META WEBHOOK] ${channel} message from ${senderId}: ${messageText.slice(0, 100)}`);

        // ── Find or create contact ──
        // Meta doesn't give us phone/email — match by meta_sender_id stored on contacts
        // First check if we've seen this sender before
        const metaIdField = channel === "facebook" ? "facebook_psid" : "instagram_id";
        const { data: existingContact } = await db
          .from("contacts")
          .select("*")
          .eq("practice_id", practice.id)
          .eq(metaIdField, senderId)
          .limit(1)
          .single();

        let contact = existingContact;

        if (!contact) {
          // Try to get the sender's name from Meta Graph API
          let senderName = "Unknown";
          if (practice.accessToken) {
            try {
              const profileRes = await fetch(
                `${GRAPH_API}/${senderId}?fields=name&access_token=${encodeURIComponent(practice.accessToken)}`,
              );
              if (profileRes.ok) {
                const profile = await profileRes.json();
                senderName = profile.name || "Unknown";
              }
            } catch {
              // Name lookup failed — not critical
            }
          }

          // Create a new contact with the meta sender ID
          const { data: newContact } = await db
            .from("contacts")
            .insert({
              practice_id: practice.id,
              name: senderName,
              source: channel,
              [metaIdField]: senderId,
            })
            .select()
            .single();

          contact = newContact;
        }

        if (!contact) {
          console.error(`[META WEBHOOK] Failed to create contact for sender ${senderId}`);
          continue;
        }

        // ── Get cross-channel conversation history ──
        const history = await getConversationContext(db, contact.id, practice.id);

        // ── Check for a recent open enquiry from this contact (within 24h) ──
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentEnquiry } = await db
          .from("enquiries")
          .select("id, conversation")
          .eq("contact_id", contact.id)
          .eq("is_completed", false)
          .gte("created_at", oneDayAgo)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (recentEnquiry) {
          // Append to existing conversation
          const updatedConversation = [
            ...(recentEnquiry.conversation || []),
            { role: "patient", message: messageText, timestamp: new Date().toISOString(), channel },
          ];
          await db
            .from("enquiries")
            .update({ conversation: updatedConversation })
            .eq("id", recentEnquiry.id);

          console.log(`[META WEBHOOK] Appended to enquiry ${recentEnquiry.id}`);
        } else {
          // Create new enquiry
          await db
            .from("enquiries")
            .insert({
              practice_id: practice.id,
              contact_id: contact.id,
              patient_name: contact.name || "Unknown",
              message: messageText,
              source: channel,
              is_urgent: false,
              is_completed: false,
              conversation: [
                { role: "patient", message: messageText, timestamp: new Date().toISOString(), channel },
              ],
            })
            .select()
            .single();
        }

        // ── Create/update conversation record ──
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

        // ── Send auto-reply ──
        if (practice.accessToken) {
          const greeting = contact.name && contact.name !== "Unknown"
            ? `Hi ${contact.name.split(" ")[0]}! `
            : "Hi! ";

          let replyText = `${greeting}Thanks for your message. The team at ${practice.name} will get back to you shortly.`;

          // If we have conversation history from other channels, acknowledge it
          if (history) {
            replyText = `${greeting}Thanks for reaching out on ${channel === "facebook" ? "Messenger" : "Instagram"}. I can see we've spoken before — the team at ${practice.name} will get back to you shortly.`;
          }

          await sendMetaReply(senderId, replyText, practice.accessToken, channel);

          // Store the reply in the conversation
          if (conv) {
            await db
              .from("conversations")
              .update({
                summary: `${channel === "facebook" ? "Facebook" : "Instagram"} message: "${messageText.slice(0, 100)}"`,
                outcome: "auto_replied",
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
