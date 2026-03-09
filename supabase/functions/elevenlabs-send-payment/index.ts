/**
 * Purpose:
 *   Called by ElevenLabs agent mid-call when a patient wants to pay.
 *   Creates a Stripe checkout session and emails the payment link.
 *
 * Used by:
 *   - ElevenLabs agent tool "Send payment link"
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { phone, email, amount_pence, patient_name, description } = body;

    if (!phone && !email) {
      return new Response(JSON.stringify({ success: false, message: "Need phone or email to find practice and send link" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find the contact and their practice
    let contact = null;
    if (phone) {
      const { data } = await adminClient
        .from("contacts")
        .select("*, practices(*)")
        .eq("phone", phone)
        .limit(1)
        .single();
      contact = data;
    }
    if (!contact && email) {
      const { data } = await adminClient
        .from("contacts")
        .select("*, practices(*)")
        .eq("email", email)
        .limit(1)
        .single();
      contact = data;
    }

    if (!contact || !contact.practices) {
      return new Response(JSON.stringify({
        success: false,
        message: "Could not find the patient's practice. The payment link cannot be sent right now. Please ask the patient to call back or visit the practice website.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const practice = contact.practices;
    const integrations = practice.integrations || {};
    const stripeSecretKey = integrations.stripe_secret_key;

    if (!stripeSecretKey) {
      return new Response(JSON.stringify({
        success: false,
        message: "Stripe is not configured for this practice. The team will need to send the payment link manually.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const patientEmail = email || contact.email;
    if (!patientEmail) {
      return new Response(JSON.stringify({
        success: false,
        message: "No email address on file for this patient. Please ask them for their email address so the payment link can be sent.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Generate short reference
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const ref = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const shortRef = `${practice.name?.slice(0, 4).toUpperCase().replace(/[^A-Z]/g, "X") || "PTHR"}-${ref}`;

    const amountPence = amount_pence || 7350; // default to £73.50 if not specified
    const amountFormatted = `£${(amountPence / 100).toFixed(2)}`;
    const desc = description || "Outstanding balance payment";

    // Create Stripe Checkout Session
    const stripeParams = new URLSearchParams();
    stripeParams.append("payment_method_types[]", "card");
    stripeParams.append("mode", "payment");
    stripeParams.append("success_url", `https://app.pathir.com/payment/success?ref=${shortRef}`);
    stripeParams.append("cancel_url", `https://app.pathir.com/payment/cancel`);
    stripeParams.append("line_items[0][price_data][currency]", "gbp");
    stripeParams.append("line_items[0][price_data][unit_amount]", String(amountPence));
    stripeParams.append("line_items[0][price_data][product_data][name]", `${practice.name} — ${desc}`);
    stripeParams.append("line_items[0][quantity]", "1");
    stripeParams.append("customer_email", patientEmail);
    stripeParams.append("metadata[short_ref]", shortRef);
    stripeParams.append("metadata[patient_name]", patient_name || contact.name);
    stripeParams.append("metadata[practice_id]", practice.id);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(stripeSecretKey + ":")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: stripeParams.toString(),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.text();
      console.error("[PAYMENT] Stripe error:", err);
      return new Response(JSON.stringify({
        success: false,
        message: "There was an issue creating the payment link. The team will follow up with the payment details.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const session = await stripeRes.json();
    const checkoutUrl = session.url;

    // Send email with payment link
    const smtpUser = Deno.env.get("SMTP_USER") || "ezi@inethos.net";
    const smtpPass = Deno.env.get("SMTP_PASS") || "xdzu rhep ocpt ofwt";

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 8px;">${practice.name}</h2>
        <p style="color: #666; font-size: 14px; margin-bottom: 24px;">Secure Payment Link</p>
        <p style="color: #333; font-size: 15px; line-height: 1.6;">
          Hi ${patient_name || contact.name},<br><br>
          As discussed, here is your secure payment link for <strong>${amountFormatted}</strong>.<br>
          Reference: <strong>${shortRef}</strong>
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${checkoutUrl}" style="background: #635BFF; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
            Pay ${amountFormatted}
          </a>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center;">
          This link is valid for 24 hours. Payments are processed securely via Stripe.
        </p>
      </div>`;

    try {
      const client = new SMTPClient({
        connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: smtpUser, password: smtpPass } },
      });
      await client.send({
        from: `${practice.name} <${smtpUser}>`,
        to: patientEmail,
        subject: `${practice.name} — Secure Payment Link (${shortRef})`,
        html,
      });
      await client.close();
    } catch (emailErr) {
      console.error("[PAYMENT] Email error:", emailErr);
      // Payment link still created even if email fails
      return new Response(JSON.stringify({
        success: true,
        message: `The payment link has been created (ref: ${shortRef}) but there was an issue sending the email. The patient can pay at: ${checkoutUrl}`,
        checkout_url: checkoutUrl,
        short_ref: shortRef,
        amount: amountFormatted,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `A payment link for ${amountFormatted} has been sent to ${patientEmail}. The reference is ${shortRef}. The patient should receive the email shortly.`,
      checkout_url: checkoutUrl,
      short_ref: shortRef,
      amount: amountFormatted,
      email_sent_to: patientEmail,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[PAYMENT ERROR]", err);
    return new Response(JSON.stringify({
      success: false,
      message: "Something went wrong creating the payment link. The practice team will follow up.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
