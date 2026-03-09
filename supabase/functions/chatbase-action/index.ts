/**
 * Purpose:
 *   Chatbase Action endpoint — called by Poppy mid-conversation.
 *   Two uses:
 *     1. On page load: ?practiceId=xxx → get practice details (hours, prices, team)
 *     2. After collecting contact info: ?practiceId=xxx&phone=xxx → look up patient history
 *
 * Dependencies:
 *   - @supabase/supabase-js (Supabase client)
 *   - _shared/match-contact.ts (getContactHistory)
 *
 * Used by:
 *   - Chatbase bot action (external HTTP call)
 *
 * Changes:
 *   2026-03-09: Ported from api/chatbase-action.js to Deno Edge Function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getContactHistory, normalizePhone } from "../_shared/match-contact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);
    const practiceId = url.searchParams.get("practiceId");
    const domain = url.searchParams.get("domain");
    const phone = url.searchParams.get("phone");
    const email = url.searchParams.get("email");

    // 1. Find practice
    // deno-lint-ignore no-explicit-any
    let practice: any = null;
    let resolvedPracticeId: string | null = null;

    if (practiceId) {
      const { data } = await adminClient
        .from("practices")
        .select("id, name, address, phone, email, website, practice_type, opening_hours, holiday_hours, practitioners, price_list, usps, practice_plan")
        .eq("id", practiceId)
        .single();
      practice = data;
      resolvedPracticeId = practiceId;
    } else if (domain) {
      const { data } = await adminClient
        .from("practices")
        .select("id, name, address, phone, email, website, practice_type, opening_hours, holiday_hours, practitioners, price_list, usps, practice_plan")
        .ilike("website", `%${domain}%`)
        .limit(1)
        .single();
      practice = data;
      resolvedPracticeId = data?.id;
    }

    if (!practice) {
      return new Response(JSON.stringify({ message: "Practice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Format practice context
    // deno-lint-ignore no-explicit-any
    const context: Record<string, any> = {
      practice_name: practice.name,
      address: practice.address,
      phone: practice.phone,
      email: practice.email,
      website: practice.website,
      type: practice.practice_type,
      opening_hours: (practice.opening_hours || [])
        // deno-lint-ignore no-explicit-any
        .map((h: any) => `${h.day}: ${h.is_open ? `${h.open_time}–${h.close_time}` : "Closed"}`)
        .join("\n"),
      team: (practice.practitioners || [])
        // deno-lint-ignore no-explicit-any
        .map((p: any) => `${p.title || ""} ${p.name} — ${p.credentials || ""} (${(p.services || []).join(", ")})`)
        .join("\n"),
      prices: (practice.price_list || [])
        // deno-lint-ignore no-explicit-any
        .map((p: any) => `${p.service_name}: £${p.price}${p.notes ? ` (${p.notes})` : ""}`)
        .join("\n"),
      about: practice.usps || "",
      practice_plan: practice.practice_plan?.offered
        ? practice.practice_plan.terms
        : "No practice plan offered",
    };

    // 3. Look up contact history if phone or email provided
    if (phone || email) {
      // deno-lint-ignore no-explicit-any
      let contact: any = null;

      if (phone) {
        const normalized = normalizePhone(phone);
        const { data } = await adminClient
          .from("contacts")
          .select("*")
          .eq("practice_id", resolvedPracticeId!)
          .eq("phone", normalized)
          .limit(1)
          .single();
        contact = data;
      }

      if (!contact && email) {
        const { data } = await adminClient
          .from("contacts")
          .select("*")
          .eq("practice_id", resolvedPracticeId!)
          .eq("email", email)
          .limit(1)
          .single();
        contact = data;
      }

      if (contact) {
        const history = await getContactHistory(adminClient, contact.id);

        context.returning_patient = true;
        context.patient_name = contact.name;
        if (contact.email) context.patient_email = contact.email;
        if (contact.phone) context.patient_phone = contact.phone;

        // Full conversation details so Poppy can reference specifics
        // deno-lint-ignore no-explicit-any
        context.previous_interactions = history.map((e: any) => {
          const channelLabel: Record<string, string> = {
            phone: "Phone call", sms: "Text message", chat: "Web chat",
            email: "Email", facebook: "Facebook", instagram: "Instagram",
          };
          const label = channelLabel[e.source] || e.source;
          const date = new Date(e.created_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
          const time = new Date(e.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

          // deno-lint-ignore no-explicit-any
          const transcript = (e.conversation || [])
            .map((m: any) => `  ${m.role === "agent" ? "Poppy" : contact.name}: ${m.message}`)
            .join("\n");

          return `[${date} at ${time} via ${label}]\nSummary: ${e.message}\nStatus: ${e.is_completed ? "Completed" : "Open"}\nFull conversation:\n${transcript || "  (no transcript)"}`;
        }).join("\n\n---\n\n");

        // deno-lint-ignore no-explicit-any
        const mostRecent = history[history.length - 1] as any;
        const daysSince = Math.floor(
          (Date.now() - new Date(mostRecent.created_at).getTime()) / 86400000,
        );

        context.instructions_for_poppy = {
          step1_before_confirmation:
            `This MIGHT be a returning patient named "${contact.name}". ` +
            `Ask: "I think we may have been in touch before — does the name ${contact.name} sound right?" ` +
            `Do NOT reveal any health details, symptoms, or what they contacted about yet.`,

          step2_after_confirmation:
            `Once they confirm identity, say they "got in touch ${daysSince === 0 ? "earlier today" : daysSince === 1 ? "yesterday" : daysSince + " days ago"}". ` +
            `Ask: "Is this about the same thing, or something new?" ` +
            `Do NOT mention specifics until they do.`,

          step3_after_they_restate:
            `Now you can use the conversation history below to help them. ` +
            `Mirror what they say and add what you know — e.g. if they say "yeah the filling", ` +
            `you can say "Of course — would today still work for you?" ` +
            `Only reference details THEY have re-confirmed in this conversation.`,

          if_wrong_person:
            `If they say "no that's not me", apologise briefly and treat as a new patient. ` +
            `Say: "No worries at all! I'm here to help — what can I do for you today?"`,
        };
      } else {
        context.returning_patient = false;
      }
    }

    return new Response(JSON.stringify(context), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
