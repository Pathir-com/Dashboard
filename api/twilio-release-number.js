import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

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

    const { practiceId } = req.body;
    if (!practiceId) return res.status(400).json({ message: "practiceId required" });

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("id, name, twilio_phone_number, owner_id")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return res.status(404).json({ message: "Practice not found or not owned by you" });
    }

    if (!practice.twilio_phone_number) {
      return res.json({ message: "No number assigned" });
    }

    const releasedNumber = practice.twilio_phone_number;

    // Clear from practice — number stays in Twilio pool for reuse
    await adminClient
      .from("practices")
      .update({ twilio_phone_number: "" })
      .eq("id", practiceId);

    return res.json({ message: `Number ${releasedNumber} released and returned to pool` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
