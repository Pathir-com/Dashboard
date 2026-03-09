import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Code expires after 10 minutes
const CODE_EXPIRY_MS = 10 * 60 * 1000;

function generateCode() {
  // Cryptographically random 6-digit code
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    // Auth check
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "Missing authorization" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return res.status(401).json({ message: "Unauthorized" });

    const { practiceId, email } = req.body;
    if (!practiceId || !email) return res.status(400).json({ message: "practiceId and email required" });

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify ownership
    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("id, name, owner_id")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return res.status(404).json({ message: "Practice not found" });
    }

    // Generate code & save
    const code = generateCode();
    await adminClient
      .from("practices")
      .update({
        email,
        email_verification_code: code,
        email_verification_sent_at: new Date().toISOString(),
        email_verified: false,
      })
      .eq("id", practiceId);

    // Send via Twilio SendGrid or Twilio email (using Twilio's built-in email via SMS for now)
    // For production, plug in SendGrid/Resend/SES here
    // For now: send via Twilio SMS to a verified number as fallback, or log it
    console.log(`[EMAIL VERIFY] Code for ${email}: ${code}`);

    // Try sending via fetch to a simple email endpoint if configured
    if (process.env.SENDGRID_API_KEY) {
      await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: "noreply@pathir.com", name: "Pathir" },
          subject: `Your verification code: ${code}`,
          content: [{
            type: "text/html",
            value: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px;">
              <h2 style="margin:0 0 8px;">Verify your email</h2>
              <p style="color:#64748b;margin:0 0 24px;">Enter this code in your Pathir dashboard:</p>
              <div style="background:#f1f5f9;border-radius:12px;padding:20px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;font-family:monospace;">${code}</div>
              <p style="color:#94a3b8;font-size:13px;margin-top:24px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
            </div>`,
          }],
        }),
      });
    } else if (process.env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Pathir <noreply@pathir.com>",
          to: [email],
          subject: `Your verification code: ${code}`,
          html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px;">
            <h2 style="margin:0 0 8px;">Verify your email</h2>
            <p style="color:#64748b;margin:0 0 24px;">Enter this code in your Pathir dashboard:</p>
            <div style="background:#f1f5f9;border-radius:12px;padding:20px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;font-family:monospace;">${code}</div>
            <p style="color:#94a3b8;font-size:13px;margin-top:24px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
          </div>`,
        }),
      });
    }

    return res.json({ message: "Code sent", email });
  } catch (err) {
    console.error("[EMAIL VERIFY ERROR]", err);
    return res.status(500).json({ message: err.message });
  }
}
