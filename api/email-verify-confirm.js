import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Code expires after 10 minutes
const CODE_EXPIRY_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "Missing authorization" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return res.status(401).json({ message: "Unauthorized" });

    const { practiceId, code } = req.body;
    if (!practiceId || !code) return res.status(400).json({ message: "practiceId and code required" });

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get practice with verification fields
    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("id, owner_id, email_verification_code, email_verification_sent_at")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return res.status(404).json({ message: "Practice not found" });
    }

    // Check code matches
    if (!practice.email_verification_code || practice.email_verification_code !== code) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    // Check not expired
    const sentAt = new Date(practice.email_verification_sent_at).getTime();
    if (Date.now() - sentAt > CODE_EXPIRY_MS) {
      return res.status(400).json({ message: "Code expired — please request a new one" });
    }

    // Mark as verified, clear the code
    await adminClient
      .from("practices")
      .update({
        email_verified: true,
        email_verification_code: null,
        email_verification_sent_at: null,
      })
      .eq("id", practiceId);

    return res.json({ message: "Email verified" });
  } catch (err) {
    console.error("[EMAIL VERIFY CONFIRM ERROR]", err);
    return res.status(500).json({ message: err.message });
  }
}
