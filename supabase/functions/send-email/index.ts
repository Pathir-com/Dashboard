/**
 * Purpose:
 *   Sends emails via SMTP with open/click tracking.
 *   Pulls the practice name + email from the DB for the From/Reply-To.
 *   Creates an email_events record so the dashboard can show delivery status.
 *
 * Expects JSON body:
 *   { to, type, data, practice_id?, enquiry_id?, contact_id?, conversation_id? }
 *   type: "payment_link" | "receipt" | "appointment_confirmation" | "new_patient_welcome"
 *
 * Changes:
 *   2026-03-11: Added open/click tracking, practice-based sender, new_patient_welcome type.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";
const SMTP_FROM = Deno.env.get("SMTP_FROM") || "";

const TRACK_BASE = `${SUPABASE_URL}/functions/v1/track-email`;

// ---------------------------------------------------------------------------
// Tracking helpers
// ---------------------------------------------------------------------------

function trackingPixel(trackingId: string): string {
  return `<img src="${TRACK_BASE}?t=${trackingId}&e=open" width="1" height="1" alt="" style="display:none;" />`;
}

function trackLink(trackingId: string, url: string, label: string, style: string): string {
  const wrapped = `${TRACK_BASE}?t=${trackingId}&e=click&u=${encodeURIComponent(url)}`;
  return `<a href="${wrapped}" style="${style}">${label}</a>`;
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function paymentLinkHtml(clinicName: string, patientName: string, amount: string, url: string, shortRef: string, trackingId: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
<tr><td style="padding:40px 30px;text-align:center;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);">
<h1 style="color:#fff;margin:0;font-size:24px;">${clinicName}</h1>
<p style="color:rgba(255,255,255,0.9);margin:10px 0 0 0;">Secure Payment Portal</p></td></tr>
<tr><td style="padding:40px 30px;">
<p style="color:#333;font-size:16px;">Dear ${patientName},</p>
<p style="color:#333;font-size:16px;">Please use the secure link below to complete your payment of <strong>${amount}</strong>.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0;"><tr><td style="text-align:center;">
${trackLink(trackingId, url, `Pay ${amount} Securely`, "display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;")}
</td></tr></table>
<p style="color:#666;font-size:14px;"><strong>Reference:</strong> ${shortRef}</p>
<p style="color:#666;font-size:14px;"><strong>Note:</strong> This link expires in 30 minutes.</p>
<hr style="border:none;border-top:1px solid #eee;margin:30px 0;">
<p style="color:#888;font-size:12px;">This is an automated message from ${clinicName}. We will never ask for your card details by phone or email.</p>
</td></tr>
<tr><td style="padding:20px 30px;background:#f9f9f9;text-align:center;">
<p style="color:#888;font-size:12px;">Secured by Stripe | PCI DSS Compliant</p></td></tr>
</table>${trackingPixel(trackingId)}</body></html>`;
}

function receiptHtml(clinicName: string, patientName: string, amount: string, shortRef: string, date: string, trackingId: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
<tr><td style="padding:40px 30px;text-align:center;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);">
<div style="font-size:48px;color:#fff;">&#10003;</div>
<h1 style="color:#fff;margin:10px 0 0 0;font-size:24px;">Payment Successful</h1></td></tr>
<tr><td style="padding:40px 30px;">
<p style="color:#333;font-size:16px;">Dear ${patientName},</p>
<p style="color:#333;font-size:16px;">Thank you for your payment. Here are your receipt details:</p>
<table width="100%" cellpadding="10" cellspacing="0" style="background:#f9f9f9;border-radius:8px;margin:20px 0;">
<tr><td style="color:#666;font-size:14px;border-bottom:1px solid #eee;">Amount Paid</td><td style="color:#333;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #eee;">${amount}</td></tr>
<tr><td style="color:#666;font-size:14px;border-bottom:1px solid #eee;">Reference</td><td style="color:#333;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #eee;">${shortRef}</td></tr>
<tr><td style="color:#666;font-size:14px;">Date</td><td style="color:#333;font-size:14px;font-weight:600;text-align:right;">${date}</td></tr>
</table>
<p style="color:#666;font-size:14px;">Please keep this email for your records.</p></td></tr>
<tr><td style="padding:20px 30px;background:#f9f9f9;text-align:center;">
<p style="color:#888;font-size:12px;">${clinicName} | Thank you for choosing us</p></td></tr>
</table>${trackingPixel(trackingId)}</body></html>`;
}

function appointmentHtml(clinicName: string, patientName: string, service: string, dateTime: string, practitioner: string, trackingId: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
<tr><td style="padding:40px 30px;text-align:center;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);">
<h1 style="color:#fff;margin:0;font-size:24px;">${clinicName}</h1>
<p style="color:rgba(255,255,255,0.9);margin:10px 0 0 0;">Appointment Confirmation</p></td></tr>
<tr><td style="padding:40px 30px;">
<p style="color:#333;font-size:16px;">Dear ${patientName},</p>
<p style="color:#333;font-size:16px;">Your appointment has been confirmed:</p>
<table width="100%" cellpadding="10" cellspacing="0" style="background:#f9f9f9;border-radius:8px;margin:20px 0;">
<tr><td style="color:#666;font-size:14px;border-bottom:1px solid #eee;">Service</td><td style="color:#333;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #eee;">${service}</td></tr>
<tr><td style="color:#666;font-size:14px;border-bottom:1px solid #eee;">Date & Time</td><td style="color:#333;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #eee;">${dateTime}</td></tr>
${practitioner ? `<tr><td style="color:#666;font-size:14px;">Practitioner</td><td style="color:#333;font-size:14px;font-weight:600;text-align:right;">${practitioner}</td></tr>` : ""}
</table>
<p style="color:#666;font-size:14px;">If you need to reschedule, please contact us as soon as possible.</p></td></tr>
<tr><td style="padding:20px 30px;background:#f9f9f9;text-align:center;">
<p style="color:#888;font-size:12px;">${clinicName}</p></td></tr>
</table>${trackingPixel(trackingId)}</body></html>`;
}

function newPatientWelcomeHtml(clinicName: string, patientName: string, trackingId: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
<tr><td style="padding:40px 30px;text-align:center;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);">
<h1 style="color:#fff;margin:0;font-size:24px;">${clinicName}</h1>
<p style="color:rgba(255,255,255,0.9);margin:10px 0 0 0;">Welcome to the practice</p></td></tr>
<tr><td style="padding:40px 30px;">
<p style="color:#333;font-size:16px;">Dear ${patientName},</p>
<p style="color:#333;font-size:16px;">Thank you for registering with ${clinicName}. We've created an account for you and your details are on file.</p>
<p style="color:#333;font-size:16px;">If you've booked an appointment, the team will confirm it shortly via text. If you need anything in the meantime, feel free to call the practice or chat with us on our website.</p>
<p style="color:#333;font-size:16px;">We look forward to seeing you!</p>
<p style="color:#333;font-size:16px;">The team at ${clinicName}</p>
</td></tr>
<tr><td style="padding:20px 30px;background:#f9f9f9;text-align:center;">
<p style="color:#888;font-size:12px;">${clinicName}</p></td></tr>
</table>${trackingPixel(trackingId)}</body></html>`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SMTP_USER || !SMTP_PASS) {
    return new Response(JSON.stringify({ error: "SMTP not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { to, type, data, practice_id, enquiry_id, contact_id, conversation_id } = body;

    if (!to || !type || !data) {
      return new Response(JSON.stringify({ error: "Missing: to, type, data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Pull the practice name + email from the DB for From/Reply-To
    let clinicName = data.clinic_name || "Spark Dental Clinic";
    let practiceEmail = "";
    let resolvedPracticeId = practice_id || null;

    if (practice_id) {
      const { data: practice } = await db
        .from("practices").select("name, email")
        .eq("id", practice_id).single();
      if (practice) {
        clinicName = practice.name || clinicName;
        practiceEmail = practice.email || "";
      }
    }

    // Create the email_events tracking record FIRST so we have the tracking_id
    const { data: emailEvent } = await db
      .from("email_events")
      .insert({
        practice_id: resolvedPracticeId,
        enquiry_id: enquiry_id || null,
        contact_id: contact_id || null,
        conversation_id: conversation_id || null,
        email_type: type,
        recipient_email: to,
        from_email: practiceEmail || SMTP_FROM || SMTP_USER,
        status: "sent",
      })
      .select("tracking_id")
      .single();

    const trackingId = emailEvent?.tracking_id || crypto.randomUUID();

    let subject = "";
    let html = "";

    switch (type) {
      case "payment_link":
        subject = `${clinicName} — Secure Payment Link`;
        html = paymentLinkHtml(clinicName, data.patient_name || "Patient", data.amount || "£0.00", data.url || "#", data.short_ref || "N/A", trackingId);
        break;
      case "receipt":
        subject = `${clinicName} — Payment Receipt`;
        html = receiptHtml(clinicName, data.patient_name || "Patient", data.amount || "£0.00", data.short_ref || "N/A", data.date || new Date().toLocaleDateString("en-GB"), trackingId);
        break;
      case "appointment_confirmation":
        subject = `${clinicName} — Appointment Confirmed`;
        html = appointmentHtml(clinicName, data.patient_name || "Patient", data.service || "Check-up", data.date_time || "TBC", data.practitioner || "", trackingId);
        break;
      case "new_patient_welcome":
        subject = `Welcome to ${clinicName}`;
        html = newPatientWelcomeHtml(clinicName, data.patient_name || "Patient", trackingId);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // Allow subject override
    if (body.subject) subject = body.subject;

    // Store subject in tracking record
    if (emailEvent) {
      await db.from("email_events").update({ subject }).eq("tracking_id", trackingId);
    }

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    // Send from our SMTP account but with practice name as display name
    // Reply-To goes to the practice's actual email so patient replies reach them
    const fromAddress = SMTP_FROM || `${clinicName} <${SMTP_USER}>`;

    const sendOpts: Record<string, unknown> = {
      from: fromAddress,
      to,
      subject,
      content: "auto",
      html,
    };
    // Set Reply-To to the practice email so replies go to them
    if (practiceEmail) {
      sendOpts.replyTo = `${clinicName} <${practiceEmail}>`;
    }

    await client.send(sendOpts);
    await client.close();

    // Mark as delivered (SMTP accepted it)
    if (emailEvent) {
      await db.from("email_events").update({
        delivered_at: new Date().toISOString(),
        status: "delivered",
      }).eq("tracking_id", trackingId);
    }

    console.log(`[SEND EMAIL] ${type} → ${to} (${subject}) tracking=${trackingId}`);
    return new Response(JSON.stringify({ success: true, to, subject, tracking_id: trackingId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[SEND EMAIL ERROR]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
