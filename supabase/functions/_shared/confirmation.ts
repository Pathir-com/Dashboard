/**
 * Booking confirmation — SMS via Twilio, email via send-email function.
 * Both are fire-and-forget (errors logged but don't block booking).
 */

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function formatDate(isoDate: string) {
  const d = new Date(isoDate + "T12:00:00Z");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

// deno-lint-ignore no-explicit-any
type DB = any;

export async function sendConfirmationSms(
  db: DB,
  opts: {
    practiceId: string; contactPhone: string; practiceName: string;
    serviceName: string; date: string; time: string; practitionerName?: string;
    messagingServiceSid?: string; twilioSmsNumber?: string; smsEnabled?: boolean;
  },
) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !opts.contactPhone) return;
  if (opts.smsEnabled === false) return;

  try {
    const from = opts.messagingServiceSid || opts.twilioSmsNumber;
    if (!from) return;

    const dateStr = formatDate(opts.date);
    let body = `Your appointment at ${opts.practiceName} is confirmed:\n\n${opts.serviceName}\n${dateStr} at ${opts.time}`;
    if (opts.practitionerName) body += ` with ${opts.practitionerName}`;
    body += `\n\nIf you need to change or cancel, just reply to this text or chat with us on our website. We look forward to seeing you!`;

    const params: Record<string, string> = { To: opts.contactPhone, Body: body };
    if (opts.messagingServiceSid) params.MessagingServiceSid = opts.messagingServiceSid;
    else params.From = opts.twilioSmsNumber!;

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      },
    );
    const result = await res.json();
    if (res.ok) console.log(`[CONFIRM SMS] Sent to ${opts.contactPhone} | SID: ${result.sid}`);
    else console.error(`[CONFIRM SMS] Failed:`, result.message || result);
  } catch (err) {
    console.error("[CONFIRM SMS] Error (non-fatal):", err);
  }
}

export function sendConfirmationEmail(opts: {
  to: string; patientName: string; practiceName: string;
  serviceName: string; date: string; time: string;
  practitionerName?: string; patientInstructions?: string;
  practiceId: string; contactId?: string;
}) {
  const dateDisplay = `${formatDate(opts.date)} at ${opts.time}`;
  const serviceField = opts.patientInstructions
    ? `${opts.serviceName}\n\n${opts.patientInstructions}`
    : opts.serviceName;

  fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: opts.to,
      type: "appointment_confirmation",
      practice_id: opts.practiceId,
      contact_id: opts.contactId,
      data: {
        patient_name: opts.patientName,
        service: serviceField,
        date_time: dateDisplay,
        practitioner: opts.practitionerName || "",
      },
    }),
  }).catch(() => {}); // fire-and-forget
}
