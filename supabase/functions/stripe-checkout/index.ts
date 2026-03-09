/**
 * Purpose:
 *   Creates a Stripe Checkout Session for payment links.
 *   Called by voice agent (ElevenLabs/VAPI) or chatbot when patient
 *   wants to pay a balance or deposit.
 *
 * Expects JSON body:
 *   { amount_pence, patient_name, patient_email?, phone?, description?, practice_id? }
 *
 * Returns:
 *   { checkout_url, session_id, short_ref }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRACTICE_ID = "7a2d6e46-5941-46a7-b858-88c0483b1e12";

function generateRef(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "";
  for (let i = 0; i < 8; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref.slice(0, 4) + "-" + ref.slice(4);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const amountPence = body.amount_pence || body.amount || 0;
    const patientName = body.patient_name || "Patient";
    const patientEmail = body.patient_email || body.email || "";
    const phone = body.phone || "";
    const description = body.description || "Dental Payment";
    const practiceId = body.practice_id || PRACTICE_ID;

    if (!amountPence || amountPence < 100) {
      return new Response(JSON.stringify({ error: "Amount must be at least £1.00 (100 pence)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get practice's Stripe key
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: practice } = await adminClient
      .from("practices")
      .select("name, integrations")
      .eq("id", practiceId)
      .single();

    const stripeSecretKey = practice?.integrations?.stripe_secret_key;
    if (!stripeSecretKey) {
      return new Response(JSON.stringify({ error: "Stripe not configured for this practice" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clinicName = practice.name || "Dental Clinic";
    const shortRef = generateRef();

    // Create Stripe Checkout Session via API
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[0]", "card");
    params.append("line_items[0][price_data][currency]", "gbp");
    params.append("line_items[0][price_data][unit_amount]", String(amountPence));
    params.append("line_items[0][price_data][product_data][name]", description);
    params.append("line_items[0][price_data][product_data][description]", `${clinicName} — Ref: ${shortRef}`);
    params.append("line_items[0][quantity]", "1");
    params.append("metadata[practice_id]", practiceId);
    params.append("metadata[short_ref]", shortRef);
    params.append("metadata[patient_name]", patientName);
    if (phone) params.append("metadata[phone]", phone);
    // Use a generic success/cancel URL
    params.append("success_url", `https://app.pathir.com/payment/success?ref=${shortRef}`);
    params.append("cancel_url", `https://app.pathir.com/payment/cancelled?ref=${shortRef}`);
    if (patientEmail) params.append("customer_email", patientEmail);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error("[STRIPE CHECKOUT ERROR]", session);
      return new Response(JSON.stringify({ error: session.error?.message || "Stripe error" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[STRIPE CHECKOUT] Created session ${session.id} for ${clinicName} — ${patientName} — £${(amountPence / 100).toFixed(2)} — ref ${shortRef}`);

    return new Response(JSON.stringify({
      checkout_url: session.url,
      session_id: session.id,
      short_ref: shortRef,
      amount: `£${(amountPence / 100).toFixed(2)}`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[STRIPE CHECKOUT ERROR]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
