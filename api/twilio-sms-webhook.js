import { createClient } from "@supabase/supabase-js";
import { findOrCreateContact } from "./_lib/match-contact.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Twilio sends a POST here for incoming SMS messages.
 * Creates an enquiry + contact, and replies based on sms_enabled setting.
 */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/xml");
  if (req.method !== "POST") return res.status(405).send("<Response/>");

  try {
    // Twilio sends form-encoded body
    const { From: from, To: to, Body: body } = req.body;

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find which practice owns this Twilio number
    const { data: practice } = await adminClient
      .from("practices")
      .select("id, name, integrations, twilio_phone_number")
      .eq("twilio_phone_number", to)
      .single();

    if (!practice) {
      console.warn(`[SMS WEBHOOK] No practice for number ${to}`);
      return res.status(200).send(`<Response><Message>This number is not currently active.</Message></Response>`);
    }

    // Check if SMS is enabled for this practice
    const smsEnabled = practice.integrations?.sms_enabled !== false;

    if (!smsEnabled) {
      // SMS disabled — tell them to call instead
      return res.status(200).send(
        `<Response><Message>Thanks for your message. This number doesn't receive texts — please call us on ${practice.twilio_phone_number} and our team will help you.</Message></Response>`
      );
    }

    // Find or create contact by phone number
    const contact = await findOrCreateContact(adminClient, {
      practiceId: practice.id,
      name: "SMS Contact",
      phone: from,
      source: "sms",
    });

    // Check if there's a recent open enquiry from this contact (within last 24h)
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

      console.log(`[SMS WEBHOOK] Created enquiry ${enquiry.id} for ${practice.name}`);
    }

    // Auto-reply acknowledgement
    return res.status(200).send(
      `<Response><Message>Thanks for your message! The team at ${practice.name} will get back to you shortly.</Message></Response>`
    );
  } catch (err) {
    console.error("[SMS WEBHOOK ERROR]", err);
    return res.status(200).send(
      `<Response><Message>Thanks for your message. We'll get back to you soon.</Message></Response>`
    );
  }
}
