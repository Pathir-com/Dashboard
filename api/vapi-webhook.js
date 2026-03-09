import { createClient } from "@supabase/supabase-js";
import { findOrCreateContact } from "./_lib/match-contact.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * VAPI sends a POST here when a call ends (server webhook).
 * Creates an enquiry + contact from the call transcript.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const event = req.body;
    const eventType = event.message?.type || event.type;

    // We only care about end-of-call reports
    if (eventType !== "end-of-call-report") {
      return res.json({ message: "Ignored", eventType });
    }

    const call = event.message || event;
    const callerNumber = call.customer?.number || call.call?.customer?.number || "";
    const twilioNumber = call.phoneNumber?.number || call.call?.phoneNumber?.number || "";

    // Build conversation from transcript
    const transcript = call.transcript || call.artifact?.transcript || [];
    const conversation = transcript.map((t) => ({
      role: t.role === "assistant" || t.role === "bot" ? "agent" : "patient",
      message: t.text || t.content || "",
      timestamp: t.startTime ? new Date(t.startTime * 1000).toISOString() : new Date().toISOString(),
    }));

    // Extract patient name from the conversation (agent usually asks for it)
    let patientName = "Phone Caller";
    const summary = call.summary || call.artifact?.summary || "";
    // Try to find name in the summary
    const nameMatch = summary.match(/(?:name is|called|patient:?)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i);
    if (nameMatch) patientName = nameMatch[1];

    // Build message from summary or first patient message
    const patientMessages = conversation.filter((m) => m.role === "patient").map((m) => m.message);
    const message = summary || patientMessages.slice(0, 3).join(" ") || "Phone call enquiry";

    // Detect urgency from keywords
    const urgentKeywords = ["emergency", "urgent", "pain", "bleeding", "swollen", "broken", "knocked out", "abscess"];
    const lowerMessage = (message + " " + patientMessages.join(" ")).toLowerCase();
    const isUrgent = urgentKeywords.some((kw) => lowerMessage.includes(kw));

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find which practice owns this Twilio number
    const { data: practice } = await adminClient
      .from("practices")
      .select("id, name")
      .eq("twilio_phone_number", twilioNumber)
      .single();

    if (!practice) {
      console.warn(`[VAPI WEBHOOK] No practice for number ${twilioNumber}`);
      return res.status(200).json({ message: "No practice matched" });
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
      return res.status(500).json({ message: "Failed to create enquiry" });
    }

    console.log(`[VAPI WEBHOOK] Enquiry ${enquiry.id} for ${practice.name} — ${patientName} (${callerNumber})`);
    return res.json({ message: "Enquiry created", enquiryId: enquiry.id, contactId: contact.id });
  } catch (err) {
    console.error("[VAPI WEBHOOK ERROR]", err);
    return res.status(500).json({ message: err.message });
  }
}
