/**
 * Purpose:
 *   Handles incoming SMS messages via Twilio webhook.
 *   Creates an enquiry + contact, appends to recent open enquiries,
 *   and replies based on the practice's sms_enabled setting.
 *
 * Dependencies:
 *   - @supabase/supabase-js (Supabase client)
 *   - _shared/match-contact.ts (findOrCreateContact)
 *
 * Used by:
 *   - Twilio SMS webhook (external POST from Twilio on incoming SMS)
 *
 * Changes:
 *   2026-03-09: Ported from api/twilio-sms-webhook.js to Deno Edge Function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findOrCreateContact } from "../_shared/match-contact.ts";

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

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find which practice owns this Twilio number
    const { data: practice } = await adminClient
      .from("practices")
      .select("id, name, integrations, twilio_phone_number")
      .eq("twilio_phone_number", to)
      .single();

    if (!practice) {
      console.warn(`[SMS WEBHOOK] No practice for number ${to}`);
      return twiml("This number is not currently active.");
    }

    // Check if SMS is enabled for this practice
    // deno-lint-ignore no-explicit-any
    const smsEnabled = (practice.integrations as any)?.sms_enabled !== false;

    if (!smsEnabled) {
      return twiml(
        `Thanks for your message. This number doesn't receive texts — please call us on ${practice.twilio_phone_number} and our team will help you.`,
      );
    }

    // Find or create contact by phone number
    const contact = await findOrCreateContact(adminClient, {
      practiceId: practice.id,
      name: "SMS Contact",
      phone: from,
      source: "sms",
    });

    // Check for a recent open enquiry from this contact (within last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentEnquiry } = await adminClient
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
        { role: "patient", message: body, timestamp: new Date().toISOString() },
      ];
      await adminClient
        .from("enquiries")
        .update({ conversation: updatedConversation })
        .eq("id", recentEnquiry.id);

      console.log(`[SMS WEBHOOK] Appended to enquiry ${recentEnquiry.id}`);
    } else {
      // Create new enquiry
      const { data: enquiry } = await adminClient
        .from("enquiries")
        .insert({
          practice_id: practice.id,
          contact_id: contact.id,
          patient_name: contact.name !== "SMS Contact" ? contact.name : "SMS Contact",
          phone_number: from,
          message: body,
          source: "sms",
          is_urgent: false,
          is_completed: false,
          conversation: [
            { role: "patient", message: body, timestamp: new Date().toISOString() },
          ],
        })
        .select()
        .single();

      console.log(`[SMS WEBHOOK] Created enquiry ${enquiry?.id} for ${practice.name}`);
    }

    return twiml(`Thanks for your message! The team at ${practice.name} will get back to you shortly.`);
  } catch (err) {
    console.error("[SMS WEBHOOK ERROR]", err);
    return twiml("Thanks for your message. We'll get back to you soon.");
  }
});
