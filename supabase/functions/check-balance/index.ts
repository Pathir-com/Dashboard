/**
 * Purpose:
 *   Look up a patient's outstanding balance by phone or email.
 *   Called by Poppy (chat or phone) before sending a payment link.
 *
 * Used by:
 *   - ElevenLabs agent tool "Check patient balance"
 *   - Chatbase bot action "Check patient balance"
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone } from "../_shared/match-contact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Accept JSON, form-encoded, or query params
    // deno-lint-ignore no-explicit-any
    let body: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";
    const url = new URL(req.url);

    if (req.method === "GET") {
      for (const [k, v] of url.searchParams) body[k] = v;
    } else {
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
      for (const [k, v] of url.searchParams) {
        if (v && !body[k]) body[k] = v;
      }
    }

    const phone = body.phone || "";
    const email = body.email || "";
    const practiceId = body.practice_id || "";

    if (!phone && !email) {
      return new Response(JSON.stringify({
        has_balance: false,
        message: "Need a phone number or email to look up the patient's balance.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find the contact — scoped to practice if provided
    // deno-lint-ignore no-explicit-any
    let contact: any = null;
    const contactCols = "id, name, phone, email, balance_pence, balance_description";

    if (phone) {
      const normalized = normalizePhone(phone);
      let q = adminClient.from("contacts").select(contactCols).eq("phone", normalized);
      if (practiceId) q = q.eq("practice_id", practiceId);
      const { data } = await q.limit(1).single();
      contact = data;
    }

    if (!contact && email) {
      let q = adminClient.from("contacts").select(contactCols).eq("email", email);
      if (practiceId) q = q.eq("practice_id", practiceId);
      const { data } = await q.limit(1).single();
      contact = data;
    }

    if (!contact) {
      return new Response(JSON.stringify({
        has_balance: false,
        message: "Could not find a patient with those details. Please check the phone number or email.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const balancePence = contact.balance_pence || 0;

    if (balancePence <= 0) {
      return new Response(JSON.stringify({
        has_balance: false,
        patient_name: contact.name,
        message: `${contact.name} has no outstanding balance. Everything is paid up.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const amountFormatted = `£${(balancePence / 100).toFixed(2)}`;

    return new Response(JSON.stringify({
      has_balance: true,
      patient_name: contact.name,
      patient_email: contact.email || null,
      amount_pence: balancePence,
      amount_formatted: amountFormatted,
      description: contact.balance_description || "Outstanding balance",
      message: `${contact.name} has an outstanding balance of ${amountFormatted} for: ${contact.balance_description || "outstanding balance"}.`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[CHECK BALANCE ERROR]", err);
    return new Response(JSON.stringify({
      has_balance: false,
      message: "Something went wrong looking up the balance. Please try again.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
