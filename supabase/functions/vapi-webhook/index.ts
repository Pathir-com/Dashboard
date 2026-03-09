/**
 * Purpose:
 *   Handles end-of-call reports from VAPI.
 *   Extracts transcript, patient name, urgency keywords.
 *   Matches Twilio number to practice, creates contact + enquiry.
 *
 * Dependencies:
 *   - @supabase/supabase-js (Supabase client)
 *   - _shared/match-contact.ts (findOrCreateContact)
 *
 * Used by:
 *   - VAPI server webhook (external POST after call ends)
 *
 * Changes:
 *   2026-03-09: Ported from api/vapi-webhook.js to Deno Edge Function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { findOrCreateContact } from "../_shared/match-contact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const URGENT_KEYWORDS = [
  "emergency", "urgent", "pain", "bleeding", "swollen",
  "broken", "knocked out", "abscess",
];

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
    const event = await req.json();
    const eventType = event.message?.type || event.type;

    // Only process end-of-call reports
    if (eventType !== "end-of-call-report") {
      return new Response(JSON.stringify({ message: "Ignored", eventType }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const call = event.message || event;
    const callerNumber = call.customer?.number || call.call?.customer?.number || "";
    const twilioNumber = call.phoneNumber?.number || call.call?.phoneNumber?.number || "";

    // Build conversation from transcript
    const transcript = call.transcript || call.artifact?.transcript || [];
    // deno-lint-ignore no-explicit-any
    const conversation = transcript.map((t: any) => ({
      role: t.role === "assistant" || t.role === "bot" ? "agent" : "patient",
      message: t.text || t.content || "",
      timestamp: t.startTime ? new Date(t.startTime * 1000).toISOString() : new Date().toISOString(),
    }));

    // Extract patient name from summary
    let patientName = "Phone Caller";
    const summary = call.summary || call.artifact?.summary || "";
    const nameMatch = summary.match(/(?:name is|called|patient:?)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i);
    if (nameMatch) patientName = nameMatch[1];

    // Build message from summary or first patient messages
    const patientMessages = conversation
      .filter((m: { role: string }) => m.role === "patient")
      .map((m: { message: string }) => m.message);
    const message = summary || patientMessages.slice(0, 3).join(" ") || "Phone call enquiry";

    // Detect urgency
    const lowerMessage = (message + " " + patientMessages.join(" ")).toLowerCase();
    const isUrgent = URGENT_KEYWORDS.some((kw) => lowerMessage.includes(kw));

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find which practice owns this Twilio number
    const { data: practice } = await adminClient
      .from("practices")
      .select("id, name")
      .eq("twilio_phone_number", twilioNumber)
      .single();

    if (!practice) {
      console.warn(`[VAPI WEBHOOK] No practice for number ${twilioNumber}`);
      return new Response(JSON.stringify({ message: "No practice matched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find or create contact
    const contact = await findOrCreateContact(adminClient, {
      practiceId: practice.id,
      name: patientName,
      phone: callerNumber,
      source: "phone",
    });

    // Create enquiry
    const { data: enquiry, error } = await adminClient
      .from("enquiries")
      .insert({
        practice_id: practice.id,
        contact_id: contact.id,
        patient_name: patientName,
        phone_number: callerNumber,
        message: message.slice(0, 500),
        source: "phone",
        is_urgent: isUrgent,
        is_completed: false,
        conversation,
      })
      .select()
      .single();

    if (error) {
      console.error("[VAPI WEBHOOK] Failed to create enquiry:", error);
      return new Response(JSON.stringify({ message: "Failed to create enquiry" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[VAPI WEBHOOK] Enquiry ${enquiry.id} for ${practice.name} — ${patientName} (${callerNumber})`);
    return new Response(
      JSON.stringify({ message: "Enquiry created", enquiryId: enquiry.id, contactId: contact.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[VAPI WEBHOOK ERROR]", err);
    return new Response(JSON.stringify({ message: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
