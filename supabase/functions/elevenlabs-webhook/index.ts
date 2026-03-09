/**
 * Purpose:
 *   Handles post-conversation webhooks from ElevenLabs Conversational AI.
 *   Extracts transcript, patient name, urgency keywords.
 *   Matches Twilio number to practice, creates contact + enquiry.
 *
 * Dependencies:
 *   - @supabase/supabase-js (Supabase client)
 *   - _shared/match-contact.ts (findOrCreateContact)
 *
 * Used by:
 *   - ElevenLabs webhook (POST after conversation ends)
 *
 * Changes:
 *   2026-03-09: Created for ElevenLabs Conversational AI migration
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

    // ElevenLabs sends conversation data with type field
    const eventType = event.type || event.event_type || "";

    // Accept post-conversation events
    if (eventType && eventType !== "post_conversation" && eventType !== "conversation.ended") {
      return new Response(JSON.stringify({ message: "Ignored", eventType }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract data from ElevenLabs format
    const data = event.data || event;
    const conversationId = data.conversation_id || data.id || "";
    const callerNumber = data.metadata?.caller_number || data.caller_number || data.from_number || "";
    const twilioNumber = data.metadata?.called_number || data.called_number || data.to_number || "";

    // Build conversation from transcript
    // ElevenLabs transcript format: array of { role, message/text, time_in_call_secs }
    const transcript = data.transcript || data.messages || [];
    // deno-lint-ignore no-explicit-any
    const conversation = transcript.map((t: any) => ({
      role: t.role === "agent" || t.role === "assistant" || t.role === "ai" ? "agent" : "patient",
      message: t.message || t.text || t.content || "",
      timestamp: t.time_in_call_secs
        ? new Date(Date.now() - ((data.call_duration_secs || 0) - t.time_in_call_secs) * 1000).toISOString()
        : new Date().toISOString(),
    }));

    // Extract patient name from conversation
    let patientName = "Phone Caller";
    const summary = data.summary || data.analysis?.summary || "";

    // Try name from summary
    const nameMatch = summary.match(/(?:name is|called|patient:?)\\s+([A-Z][a-z]+ [A-Z][a-z]+)/i);
    if (nameMatch) patientName = nameMatch[1];

    // Try name from collected data (ElevenLabs can collect structured data)
    if (data.collected_data?.name) {
      patientName = data.collected_data.name;
    }
    if (data.metadata?.patient_name) {
      patientName = data.metadata.patient_name;
    }

    // Build message
    const patientMessages = conversation
      .filter((m: { role: string }) => m.role === "patient")
      .map((m: { message: string }) => m.message);
    const message = summary || patientMessages.slice(0, 3).join(" ") || "Phone call enquiry";

    // Detect urgency
    const lowerMessage = (message + " " + patientMessages.join(" ")).toLowerCase();
    const isUrgent = URGENT_KEYWORDS.some((kw) => lowerMessage.includes(kw));

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find which practice owns this Twilio number
    let practiceId = data.metadata?.practice_id || "";
    let practiceName = "";

    if (twilioNumber) {
      const { data: practice } = await adminClient
        .from("practices")
        .select("id, name")
        .eq("twilio_phone_number", twilioNumber)
        .single();

      if (practice) {
        practiceId = practice.id;
        practiceName = practice.name;
      }
    }

    // Fallback to hardcoded practice if no number match
    if (!practiceId) {
      practiceId = "7a2d6e46-5941-46a7-b858-88c0483b1e12";
      const { data: practice } = await adminClient
        .from("practices")
        .select("name")
        .eq("id", practiceId)
        .single();
      practiceName = practice?.name || "Unknown";
    }

    // Find or create contact
    const contact = await findOrCreateContact(adminClient, {
      practiceId,
      name: patientName,
      phone: callerNumber,
      source: "phone",
    });

    // Create enquiry
    const { data: enquiry, error } = await adminClient
      .from("enquiries")
      .insert({
        practice_id: practiceId,
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
      console.error("[ELEVENLABS WEBHOOK] Failed to create enquiry:", error);
      return new Response(JSON.stringify({ message: "Failed to create enquiry" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[ELEVENLABS WEBHOOK] Enquiry ${enquiry.id} for ${practiceName} — ${patientName} (${callerNumber}) conv=${conversationId}`);
    return new Response(
      JSON.stringify({ message: "Enquiry created", enquiryId: enquiry.id, contactId: contact.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ELEVENLABS WEBHOOK ERROR]", err);
    return new Response(JSON.stringify({ message: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
