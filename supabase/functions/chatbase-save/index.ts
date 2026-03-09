/**
 * Purpose:
 *   Called by Poppy at the end of every web chat conversation.
 *   Creates or updates an enquiry with the conversation summary and booking details.
 *
 * Dependencies:
 *   - @supabase/supabase-js (Supabase client)
 *   - _shared/match-contact.ts (findOrCreateContact)
 *
 * Used by:
 *   - Chatbase bot action "Save conversation" (POST from Chatbase)
 *
 * Changes:
 *   2026-03-09: Created as Deno Edge Function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { findOrCreateContact } from "../_shared/match-contact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    // Parse body — handle JSON, form-encoded, or empty
    let body: Record<string, string> = {};
    const contentType = req.headers.get("content-type") || "";
    const rawBody = await req.text();

    if (rawBody) {
      if (contentType.includes("json")) {
        body = JSON.parse(rawBody);
      } else {
        // Form-encoded fallback
        for (const pair of rawBody.split("&")) {
          const [key, value] = pair.split("=");
          if (key) body[decodeURIComponent(key)] = decodeURIComponent(value || "");
        }
      }
    }

    // Also accept practiceId from query params (Chatbase may send fixed params there)
    const url = new URL(req.url);
    const practiceId = body.practiceId || url.searchParams.get("practiceId") || "";
    const name = body.name || url.searchParams.get("name") || "";
    const phone = body.phone || url.searchParams.get("phone") || "";
    const email = body.email || url.searchParams.get("email") || "";
    const summary = body.summary || url.searchParams.get("summary") || "";
    const appointmentType = body.appointmentType || url.searchParams.get("appointmentType") || "";
    const isUrgent = body.isUrgent === "true" || body.isUrgent === true;
    const transcript = body.transcript || url.searchParams.get("transcript") || "";

    if (!practiceId) {
      return new Response(JSON.stringify({ message: "practiceId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find or create contact
    const contact = await findOrCreateContact(adminClient, {
      practiceId,
      name: name || "Website Visitor",
      phone: phone || undefined,
      email: email || undefined,
      source: "chat",
    });

    // Check for a recent open enquiry from this contact (avoid duplicates)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await adminClient
      .from("enquiries")
      .select("id")
      .eq("contact_id", contact.id)
      .eq("source", "chat")
      .eq("is_completed", false)
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const message = summary || `Web chat: ${appointmentType || "general enquiry"}`;

    if (recent) {
      // Update existing — include transcript if provided
      const updateData: Record<string, unknown> = {
        message,
        patient_name: name || contact.name,
        selected_service: appointmentType || null,
      };
      if (transcript) {
        const conv: Array<{ role: string; message: string; timestamp: string }> = [];
        const lines = transcript.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          const match = line.match(/^(Poppy|Patient|Agent|User|Me|Johannis[^:]*)\s*:\s*(.+)/i);
          if (match) {
            const role = /poppy|agent/i.test(match[1]) ? "agent" : "patient";
            conv.push({ role, message: match[2].trim(), timestamp: new Date().toISOString() });
          } else if (line.trim()) {
            conv.push({ role: "patient", message: line.trim(), timestamp: new Date().toISOString() });
          }
        }
        if (conv.length > 0) updateData.conversation = conv;
      }
      await adminClient
        .from("enquiries")
        .update(updateData)
        .eq("id", recent.id);

      return new Response(
        JSON.stringify({ message: "Conversation updated", enquiryId: recent.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse transcript into conversation array
    // Transcript comes as text like "Patient: Hi\nPoppy: Hello\nPatient: I need..."
    const conversation: Array<{ role: string; message: string; timestamp: string }> = [];
    if (transcript) {
      const lines = transcript.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        const match = line.match(/^(Poppy|Patient|Agent|User|Me|Johannis[^:]*)\s*:\s*(.+)/i);
        if (match) {
          const role = /poppy|agent/i.test(match[1]) ? "agent" : "patient";
          conversation.push({ role, message: match[2].trim(), timestamp: new Date().toISOString() });
        } else if (line.trim()) {
          conversation.push({ role: "patient", message: line.trim(), timestamp: new Date().toISOString() });
        }
      }
    }
    if (conversation.length === 0) {
      conversation.push({ role: "agent", message: `Summary: ${message}`, timestamp: new Date().toISOString() });
    }

    // Create new enquiry
    const { data: enquiry, error } = await adminClient
      .from("enquiries")
      .insert({
        practice_id: practiceId,
        contact_id: contact.id,
        patient_name: name || contact.name,
        phone_number: phone || "",
        message,
        source: "chat",
        is_urgent: isUrgent || false,
        is_completed: false,
        selected_service: appointmentType || null,
        conversation,
      })
      .select()
      .single();

    if (error) {
      console.error("[CHATBASE SAVE] Failed:", error);
      return new Response(JSON.stringify({ message: "Failed to save" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[CHATBASE SAVE] Enquiry ${enquiry.id} — ${name} — ${message}`);
    return new Response(
      JSON.stringify({ message: "Conversation saved", enquiryId: enquiry.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[CHATBASE SAVE ERROR]", err);
    return new Response(JSON.stringify({ message: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
