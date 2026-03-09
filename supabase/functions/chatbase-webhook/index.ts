/**
 * Purpose:
 *   Handles lead submission webhooks from Chatbase.
 *   Matches the chatbot to a practice, fetches conversation transcript,
 *   creates a contact + enquiry with cross-channel matching.
 *
 * Dependencies:
 *   - @supabase/supabase-js (Supabase client)
 *   - _shared/match-contact.ts (findOrCreateContact)
 *
 * Used by:
 *   - Chatbase webhook (external POST from Chatbase on leads.submit)
 *
 * Changes:
 *   2026-03-09: Ported from api/chatbase-webhook.js to Deno Edge Function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { findOrCreateContact } from "../_shared/match-contact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHATBASE_API_KEY = Deno.env.get("CHATBASE_API_KEY") || "";
const CHATBASE_WEBHOOK_SECRET = Deno.env.get("CHATBASE_WEBHOOK_SECRET") || "";

/**
 * Verify HMAC-SHA1 signature from Chatbase if a webhook secret is configured.
 */
async function verifySignature(body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(CHATBASE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ message: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const rawBody = await req.text();

    // Verify signature if secret is configured
    if (CHATBASE_WEBHOOK_SECRET) {
      const signature = req.headers.get("x-chatbase-signature") || "";
      const valid = await verifySignature(rawBody, signature);
      if (!valid) {
        console.warn("[CHATBASE WEBHOOK] Invalid signature");
        return new Response(JSON.stringify({ message: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = JSON.parse(rawBody);
    const { eventType, chatbotId, payload } = body;

    if (eventType !== "leads.submit") {
      return new Response(JSON.stringify({ message: "Event ignored", eventType }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversationId, customerEmail, customerName, customerPhone } = payload;
    console.log(`[CHATBASE WEBHOOK] Lead from ${chatbotId}: ${customerName} (${customerEmail})`);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find which practice this chatbot belongs to
    const { data: practice } = await adminClient
      .from("practices")
      .select("id, name")
      .eq("chatbase_agent_id", chatbotId)
      .single();

    if (!practice) {
      console.warn(`[CHATBASE WEBHOOK] No practice found for chatbot ${chatbotId}`);
      return new Response(JSON.stringify({ message: "No practice matched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch conversation messages from Chatbase API
    let conversation: Array<{ role: string; message: string; timestamp: string }> = [];
    if (CHATBASE_API_KEY && conversationId) {
      try {
        const convRes = await fetch(
          `https://www.chatbase.co/api/v2/agents/${chatbotId}/conversations/${conversationId}/messages`,
          { headers: { Authorization: `Bearer ${CHATBASE_API_KEY}` } },
        );
        if (convRes.ok) {
          const convData = await convRes.json();
          const messages = convData.data || convData.messages || [];
          // deno-lint-ignore no-explicit-any
          conversation = messages.map((m: any) => ({
            role: m.role === "assistant" ? "agent" : "patient",
            message: m.content || m.text || "",
            timestamp: m.createdAt || new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.warn("[CHATBASE WEBHOOK] Failed to fetch conversation:", (err as Error).message);
      }
    }

    // Build a summary from patient messages
    const patientMessages = conversation
      .filter((m) => m.role === "patient")
      .map((m) => m.message);
    const summary = patientMessages.length > 0
      ? patientMessages.join(" ").slice(0, 500)
      : `Web chat enquiry from ${customerName}`;

    // Find or create contact (matches across phone/email)
    const contact = await findOrCreateContact(adminClient, {
      practiceId: practice.id,
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
      source: "chat",
    });

    // Create enquiry linked to the contact
    const { data: enquiry, error: enquiryError } = await adminClient
      .from("enquiries")
      .insert({
        practice_id: practice.id,
        contact_id: contact.id,
        patient_name: customerName || "Website Visitor",
        phone_number: customerPhone || "",
        message: summary,
        source: "chat",
        is_urgent: false,
        is_completed: false,
        conversation,
      })
      .select()
      .single();

    if (enquiryError) {
      console.error("[CHATBASE WEBHOOK] Failed to create enquiry:", enquiryError);
      return new Response(JSON.stringify({ message: "Failed to create enquiry" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[CHATBASE WEBHOOK] Created enquiry ${enquiry.id} for ${practice.name}`);
    return new Response(JSON.stringify({ message: "Enquiry created", enquiryId: enquiry.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[CHATBASE WEBHOOK ERROR]", err);
    return new Response(JSON.stringify({ message: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
