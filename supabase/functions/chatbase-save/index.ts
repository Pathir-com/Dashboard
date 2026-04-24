/**
 * Purpose:
 *   Called by Poppy at the end of every web chat conversation. Creates or
 *   updates an enquiry with summary and booking details, and writes the
 *   transcript as individual message rows in enquiry_messages.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/match-contact.ts (findOrCreateContact)
 *   - _shared/conversation.ts (insertMessages)
 *
 * Used by:
 *   - Chatbase bot action "Save conversation" (POST from Chatbase)
 *
 * Changes:
 *   2026-04-24: Drop writes to enquiries.conversation JSONB. Parsed
 *               transcript lines now become rows in enquiry_messages so the
 *               dashboard renders the same data as every other channel.
 *   2026-03-09: Created as Deno Edge Function.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { findOrCreateContact } from "../_shared/match-contact.ts";
import { insertMessages, type MessageRole } from "../_shared/conversation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ParsedMessage {
  role: MessageRole;
  message: string;
}

/**
 * Parse a transcript like "Poppy: hi\nPatient: hello" into role-tagged
 * message objects. Lines without a recognised speaker prefix default to
 * "patient" since unrecognised text is most often unprompted user input.
 */
function parseTranscript(transcript: string): ParsedMessage[] {
  const out: ParsedMessage[] = [];
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(Poppy|Patient|Agent|User|Me|Johannis[^:]*)\s*:\s*(.+)/i);
    if (match) {
      const role: MessageRole = /poppy|agent/i.test(match[1]) ? "clinic" : "patient";
      out.push({ role, message: match[2].trim() });
    } else {
      out.push({ role: "patient", message: trimmed });
    }
  }
  return out;
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
    let body: Record<string, string> = {};
    const contentType = req.headers.get("content-type") || "";
    const rawBody = await req.text();

    if (rawBody) {
      if (contentType.includes("json")) {
        body = JSON.parse(rawBody);
      } else {
        for (const pair of rawBody.split("&")) {
          const [key, value] = pair.split("=");
          if (key) body[decodeURIComponent(key)] = decodeURIComponent(value || "");
        }
      }
    }

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

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const contact = await findOrCreateContact(db, {
      practiceId,
      name: name || "Website Visitor",
      phone: phone || undefined,
      email: email || undefined,
      source: "chat",
    });

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await db
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
    const parsedMessages = transcript ? parseTranscript(transcript) : [];

    let enquiryId: string;

    if (recent) {
      await db
        .from("enquiries")
        .update({
          message,
          patient_name: name || contact.name,
          selected_service: appointmentType || null,
        })
        .eq("id", recent.id);
      enquiryId = recent.id;
    } else {
      const { data: created, error } = await db
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
        })
        .select("id")
        .single();

      if (error || !created) {
        console.error("[CHATBASE SAVE] Failed:", error);
        return new Response(JSON.stringify({ message: "Failed to save" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      enquiryId = created.id;
    }

    if (parsedMessages.length > 0) {
      await insertMessages(db, parsedMessages.map((m) => ({
        enquiryId,
        role: m.role,
        message: m.message,
        channel: "web_chat",
      })));
    }

    console.log(`[CHATBASE SAVE] Enquiry ${enquiryId} — ${name} — ${message} (+${parsedMessages.length} msgs)`);
    return new Response(
      JSON.stringify({ message: "Conversation saved", enquiryId }),
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
