import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { findOrCreateContact } from "./_lib/match-contact.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY;
const CHATBASE_WEBHOOK_SECRET = process.env.CHATBASE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-chatbase-signature");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    // Verify signature if secret is configured
    if (CHATBASE_WEBHOOK_SECRET) {
      const signature = req.headers["x-chatbase-signature"];
      const body = JSON.stringify(req.body);
      const expected = crypto.createHmac("sha1", CHATBASE_WEBHOOK_SECRET).update(body).digest("hex");
      if (signature !== expected) {
        console.warn("[CHATBASE WEBHOOK] Invalid signature");
        return res.status(401).json({ message: "Invalid signature" });
      }
    }

    const { eventType, chatbotId, payload } = req.body;

    if (eventType !== "leads.submit") {
      // Acknowledge but ignore non-lead events
      return res.json({ message: "Event ignored", eventType });
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
      return res.status(200).json({ message: "No practice matched" });
    }

    // Fetch the conversation messages from Chatbase API
    let conversation = [];
    if (CHATBASE_API_KEY && conversationId) {
      try {
        const convRes = await fetch(
          `https://www.chatbase.co/api/v2/agents/${chatbotId}/conversations/${conversationId}/messages`,
          {
            headers: { Authorization: `Bearer ${CHATBASE_API_KEY}` },
          }
        );
        if (convRes.ok) {
          const convData = await convRes.json();
          const messages = convData.data || convData.messages || [];
          conversation = messages.map((m) => ({
            role: m.role === "assistant" ? "agent" : "patient",
            message: m.content || m.text || "",
            timestamp: m.createdAt || new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.warn("[CHATBASE WEBHOOK] Failed to fetch conversation:", err.message);
      }
    }

    // Build a summary message from the conversation
    const patientMessages = conversation
      .filter((m) => m.role === "patient")
      .map((m) => m.message);
    const summary = patientMessages.length > 0
      ? patientMessages.join(" ").slice(0, 500)
      : `Web chat enquiry from ${customerName}`;

    // Find or create a contact (matches across phone/email/social)
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
      return res.status(500).json({ message: "Failed to create enquiry" });
    }

    console.log(`[CHATBASE WEBHOOK] Created enquiry ${enquiry.id} for ${practice.name}`);
    return res.json({ message: "Enquiry created", enquiryId: enquiry.id });
  } catch (err) {
    console.error("[CHATBASE WEBHOOK ERROR]", err);
    return res.status(500).json({ message: err.message });
  }
}
