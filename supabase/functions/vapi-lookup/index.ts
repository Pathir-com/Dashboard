/**
 * Purpose:
 *   Handles mid-call tool calls from VAPI to look up patient history.
 *   VAPI sends tool calls in a specific format — this function translates
 *   and calls the same logic as chatbase-action.
 *
 * Dependencies:
 *   - @supabase/supabase-js (Supabase client)
 *   - _shared/match-contact.ts (getContactHistory)
 *
 * Used by:
 *   - VAPI assistant tool "look_up_patient" (mid-call HTTP request)
 *
 * Changes:
 *   2026-03-09: Created as Deno Edge Function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getContactHistory, normalizePhone } from "../_shared/match-contact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRACTICE_ID = "7a2d6e46-5941-46a7-b858-88c0483b1e12";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // VAPI sends tool calls wrapped in a message object
    const toolCall = body.message?.toolCallList?.[0] || body;
    const args = toolCall.function?.arguments || toolCall.arguments || body;
    const rawPhone = args.phone || "";
    const phone = rawPhone ? normalizePhone(rawPhone) : "";
    const email = (args.email || "").trim().toLowerCase();

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up contact by phone or email
    // deno-lint-ignore no-explicit-any
    let contact: any = null;

    if (phone) {
      const { data } = await adminClient
        .from("contacts")
        .select("*")
        .eq("practice_id", PRACTICE_ID)
        .eq("phone", phone)
        .limit(1)
        .single();
      contact = data;
    }

    if (!contact && email) {
      const { data } = await adminClient
        .from("contacts")
        .select("*")
        .eq("practice_id", PRACTICE_ID)
        .eq("email", email)
        .limit(1)
        .single();
      contact = data;
    }

    if (!contact) {
      // VAPI expects results array
      return new Response(JSON.stringify({
        results: [{
          toolCallId: toolCall.id || "",
          result: JSON.stringify({ returning_patient: false }),
        }],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const history = await getContactHistory(adminClient, contact.id);

    const channelLabel: Record<string, string> = {
      phone: "Phone call", sms: "Text message", chat: "Web chat",
      email: "Email", facebook: "Facebook", instagram: "Instagram",
    };

    // deno-lint-ignore no-explicit-any
    const interactions = history.map((e: any) => {
      const label = channelLabel[e.source] || e.source;
      const date = new Date(e.created_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
      return `[${date} via ${label}] ${e.message} (${e.is_completed ? "Completed" : "Open"})`;
    }).join("\n");

    const mostRecent = history[history.length - 1];
    // deno-lint-ignore no-explicit-any
    const daysSince = Math.floor((Date.now() - new Date((mostRecent as any).created_at).getTime()) / 86400000);

    const result = {
      returning_patient: true,
      patient_name: contact.name,
      days_since_last_contact: daysSince,
      previous_interactions: interactions,
      note: `This is a returning patient. Greet them by name. They last got in touch ${daysSince === 0 ? "earlier today" : daysSince === 1 ? "yesterday" : daysSince + " days ago"}. Do NOT reveal health details until they bring it up. Ask: "Is this about the same thing you contacted us about, or something new?"`,
    };

    return new Response(JSON.stringify({
      results: [{
        toolCallId: toolCall.id || "",
        result: JSON.stringify(result),
      }],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[VAPI LOOKUP ERROR]", err);
    return new Response(JSON.stringify({
      results: [{
        toolCallId: "",
        result: JSON.stringify({ returning_patient: false, error: (err as Error).message }),
      }],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
