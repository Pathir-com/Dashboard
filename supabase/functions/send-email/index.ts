/**
 * Purpose:
 *   Sends emails via SMTP (Gmail). Used for:
 *   - Payment link emails
 *   - Payment receipt/confirmation emails
 *   - Appointment confirmation emails
 *
 * Expects JSON body:
 *   { to, subject, type, data }
 *   type: "payment_link" | "receipt" | "appointment_confirmation"
 */

import { corsHeaders } from "../_shared/cors.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";
const SMTP_FROM = Deno.env.get("SMTP_FROM") || "";

function paymentLinkHtml(clinicName: string, patientName: string, amount: string, url: string, shortRef: string): string {
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
<a href="${url}" style="display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Pay ${amount} Securely</a>
</td></tr></table>
<p style="color:#666;font-size:14px;"><strong>Reference:</strong> ${shortRef}</p>
<p style="color:#666;font-size:14px;"><strong>Note:</strong> This link expires in 30 minutes.</p>
<hr style="border:none;border-top:1px solid #eee;margin:30px 0;">
<p style="color:#888;font-size:12px;">This is an automated message from ${clinicName}. We will never ask for your card details by phone or email.</p>
</td></tr>
<tr><td style="padding:20px 30px;background:#f9f9f9;text-align:center;">
<p style="color:#888;font-size:12px;">Secured by Stripe | PCI DSS Compliant</p></td></tr>
</table></body></html>`;
}

function receiptHtml(clinicName: string, patientName: string, amount: string, shortRef: string, date: string): string {
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
</table></body></html>`;
}

function appointmentHtml(clinicName: string, patientName: string, service: string, dateTime: string, practitioner: string): string {
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
</table></body></html>`;
}

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
    const { to, type, data } = body;

    if (!to || !type || !data) {
      return new Response(JSON.stringify({ error: "Missing: to, type, data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subject = "";
    let html = "";
    const clinicName = data.clinic_name || "Spark Dental Clinic";

    switch (type) {
      case "payment_link":
        subject = `${clinicName} — Secure Payment Link`;
        html = paymentLinkHtml(clinicName, data.patient_name || "Patient", data.amount || "£0.00", data.url || "#", data.short_ref || "N/A");
        break;
      case "receipt":
        subject = `${clinicName} — Payment Receipt`;
        html = receiptHtml(clinicName, data.patient_name || "Patient", data.amount || "£0.00", data.short_ref || "N/A", data.date || new Date().toLocaleDateString("en-GB"));
        break;
      case "appointment_confirmation":
        subject = `${clinicName} — Appointment Confirmed`;
        html = appointmentHtml(clinicName, data.patient_name || "Patient", data.service || "Check-up", data.date_time || "TBC", data.practitioner || "");
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    await client.send({
      from: SMTP_FROM || `${clinicName} <${SMTP_USER}>`,
      to,
      subject,
      content: "auto",
      html,
    });

    await client.close();

    console.log(`[SEND EMAIL] ${type} → ${to} (${subject})`);
    return new Response(JSON.stringify({ success: true, to, subject }), {
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
