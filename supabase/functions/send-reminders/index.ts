/**
 * Daily appointment reminder — sends SMS/email the day before.
 * Triggered by pg_cron at 18:00 UTC daily.
 *
 * For each tomorrow's appointment:
 *   - If contact has email → send reminder email
 *   - If contact has phone → send reminder SMS
 *   - Track in email_events / sms_events
 *   - Mark appointment.reminder_sent_at to prevent duplicates
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";

function formatDate(isoDate: string) {
  const d = new Date(isoDate + "T12:00:00Z");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Find tomorrow's date in UK timezone
  const ukNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
  const tomorrow = new Date(ukNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  // Get all confirmed appointments for tomorrow that haven't been reminded
  const { data: appointments, error } = await db
    .from("appointments")
    .select(`
      id, starts_at, status, practice_id, contact_id, practitioner_id, service_id, notes,
      contacts ( id, name, phone, email ),
      practitioners ( name ),
      services ( name, patient_instructions ),
      practices ( name, messaging_service_sid, twilio_sms_number, integrations )
    `)
    .gte("starts_at", `${tomorrowISO}T00:00:00`)
    .lt("starts_at", `${tomorrowISO}T23:59:59`)
    .eq("status", "confirmed")
    .is("reminder_sent_at", null);

  if (error) {
    console.error("[REMINDERS] Query error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: { appointment_id: string; email: boolean; sms: boolean }[] = [];

  for (const appt of (appointments || [])) {
    const contact = appt.contacts;
    const practitioner = appt.practitioners;
    const service = appt.services;
    const practice = appt.practices;

    if (!contact) continue;

    const startTime = new Date(appt.starts_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    const dateDisplay = formatDate(tomorrowISO);
    const serviceName = service?.name || "Appointment";
    const practiceName = practice?.name || "the clinic";
    const practitionerName = practitioner?.name || "";
    const patientName = contact.name || "Patient";

    let emailSent = false, smsSent = false;

    // Find linked enquiry for tracking
    const { data: enquiryRow } = await db.from("enquiries").select("id").eq("contact_id", contact.id).eq("appointment_datetime", appt.starts_at).limit(1).single();
    const enquiryId = enquiryRow?.id || null;

    // Send email reminder
    if (contact.email) {
      try {
        const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: contact.email,
            type: "appointment_confirmation",
            practice_id: appt.practice_id,
            contact_id: contact.id,
            enquiry_id: enquiryId,
            subject: `Reminder: ${serviceName} tomorrow at ${startTime}`,
            data: {
              patient_name: patientName,
              service: service?.patient_instructions ? `${serviceName}\n\n${service.patient_instructions}` : serviceName,
              date_time: `${dateDisplay} at ${startTime}`,
              practitioner: practitionerName,
            },
          }),
        });
        emailSent = emailRes.ok;
      } catch { /* non-fatal */ }
    }

    // Send SMS reminder
    if (contact.phone && TWILIO_SID && TWILIO_TOKEN) {
      const from = practice?.messaging_service_sid || practice?.twilio_sms_number;
      if (from && practice?.integrations?.sms_enabled !== false) {
        try {
          let body = `Reminder: your ${serviceName} at ${practiceName} is tomorrow, ${dateDisplay} at ${startTime}`;
          if (practitionerName) body += ` with ${practitionerName}`;
          body += ". We look forward to seeing you!";
          if (service?.patient_instructions) body += `\n\n${service.patient_instructions}`;

          const params: Record<string, string> = { To: contact.phone, Body: body };
          if (practice.messaging_service_sid) params.MessagingServiceSid = practice.messaging_service_sid;
          else params.From = practice.twilio_sms_number;

          const smsRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
            method: "POST",
            headers: { Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(params).toString(),
          });
          const smsData = await smsRes.json();

          // Track in sms_events
          await db.from("sms_events").insert({
            practice_id: appt.practice_id,
            enquiry_id: enquiryId,
            contact_id: contact.id,
            appointment_id: appt.id,
            sms_type: "reminder",
            recipient_phone: contact.phone,
            from_sender: practice.messaging_service_sid ? practiceName : practice.twilio_sms_number,
            body,
            status: smsRes.ok ? "sent" : "failed",
            twilio_sid: smsData.sid || null,
          });

          smsSent = smsRes.ok;
        } catch { /* non-fatal */ }
      }
    }

    // Mark reminder sent
    await db.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appt.id);

    results.push({ appointment_id: appt.id, email: emailSent, sms: smsSent });
    console.log(`[REMINDERS] ${patientName} — ${serviceName} ${dateDisplay} ${startTime} — email=${emailSent} sms=${smsSent}`);
  }

  return new Response(JSON.stringify({ sent: results.length, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
