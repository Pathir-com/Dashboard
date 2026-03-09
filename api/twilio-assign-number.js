import { createClient } from "@supabase/supabase-js";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const VAPI_WEBHOOK_URL = "https://api.vapi.ai/twilio/inbound_call";

const UK_AREA_CODES = [
  { keywords: ["london", "harley street", "mayfair", "chelsea", "kensington", "westminster", "sw1", "w1", "ec1", "wc1", "se1", "e1", "n1", "nw1"], areaCode: "020", region: "London" },
  { keywords: ["manchester", "salford", "stockport", "m1", "m2", "m3"], areaCode: "0161", region: "Manchester" },
  { keywords: ["birmingham", "solihull", "edgbaston", "b1", "b2"], areaCode: "0121", region: "Birmingham" },
  { keywords: ["liverpool", "merseyside", "l1", "l2"], areaCode: "0151", region: "Liverpool" },
  { keywords: ["leeds", "wakefield", "ls1", "ls2"], areaCode: "0113", region: "Leeds" },
  { keywords: ["sheffield", "s1", "s2"], areaCode: "0114", region: "Sheffield" },
  { keywords: ["bristol", "bs1", "bs2"], areaCode: "0117", region: "Bristol" },
  { keywords: ["edinburgh", "eh1", "eh2"], areaCode: "0131", region: "Edinburgh" },
  { keywords: ["glasgow", "g1", "g2"], areaCode: "0141", region: "Glasgow" },
  { keywords: ["belfast", "bt1", "bt2"], areaCode: "028", region: "Belfast" },
  { keywords: ["cardiff", "cf1", "cf2"], areaCode: "029", region: "Cardiff" },
  { keywords: ["nottingham", "ng1", "ng2"], areaCode: "0115", region: "Nottingham" },
  { keywords: ["newcastle", "gateshead", "ne1", "ne2"], areaCode: "0191", region: "Newcastle" },
  { keywords: ["brighton", "hove", "bn1"], areaCode: "01273", region: "Brighton" },
  { keywords: ["cambridge", "cb1", "cb2"], areaCode: "01223", region: "Cambridge" },
  { keywords: ["oxford", "ox1", "ox2"], areaCode: "01865", region: "Oxford" },
];

function detectAreaCode(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const entry of UK_AREA_CODES) {
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) return entry;
    }
  }
  return null;
}

const twilioAuth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");

async function twilioGet(path) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`, {
    headers: { Authorization: `Basic ${twilioAuth}` },
  });
  return res.json();
}

async function twilioPost(path, body) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${twilioAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

async function findPooledNumber(areaCode, assignedNumbers) {
  const data = await twilioGet("/IncomingPhoneNumbers.json?PageSize=100");
  const allNumbers = data.incoming_phone_numbers || [];

  if (areaCode) {
    const e164Prefix = "+44" + areaCode.replace(/^0/, "");
    const pooled = allNumbers.filter(
      (n) => !assignedNumbers.has(n.phone_number) && n.phone_number.startsWith(e164Prefix)
    );
    if (pooled.length > 0) return pooled[0];
  }

  const anyPooled = allNumbers.filter((n) => !assignedNumbers.has(n.phone_number));
  return anyPooled.length > 0 ? anyPooled[0] : null;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    // Verify user auth
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

    // Verify ownership
    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("*")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return res.status(404).json({ message: "Practice not found or not owned by you" });
    }

    if (practice.twilio_phone_number) {
      return res.json({ phoneNumber: practice.twilio_phone_number, message: "Already assigned" });
    }

    // Get assigned numbers
    const { data: allPractices } = await adminClient.from("practices").select("twilio_phone_number");
    const assignedNumbers = new Set(
      (allPractices || []).map((p) => p.twilio_phone_number).filter(Boolean)
    );

    const match = detectAreaCode(practice.address);
    let phoneNumber = null;

    // Check pool
    const pooled = await findPooledNumber(match?.areaCode || null, assignedNumbers);
    if (pooled) {
      phoneNumber = pooled.phone_number;
      await twilioPost(`/IncomingPhoneNumbers/${pooled.sid}.json`, {
        VoiceUrl: VAPI_WEBHOOK_URL,
        VoiceMethod: "POST",
        FriendlyName: `Pathir - ${practice.name}`,
      });
    }

    // Buy if no pooled number
    if (!phoneNumber) {
      let available = [];
      if (match) {
        const e164Prefix = "+44" + match.areaCode.replace(/^0/, "");
        const data = await twilioGet(
          `/AvailablePhoneNumbers/GB/Local.json?Contains=${encodeURIComponent(e164Prefix)}&PageSize=5&VoiceEnabled=true&SmsEnabled=true`
        );
        available = data.available_phone_numbers || [];
      }
      if (available.length === 0) {
        const data = await twilioGet(
          `/AvailablePhoneNumbers/GB/Local.json?PageSize=5&VoiceEnabled=true&SmsEnabled=true`
        );
        available = data.available_phone_numbers || [];
      }
      if (available.length === 0) {
        return res.status(503).json({ message: "No UK numbers available on Twilio" });
      }

      const purchased = await twilioPost("/IncomingPhoneNumbers.json", {
        PhoneNumber: available[0].phone_number,
        VoiceUrl: VAPI_WEBHOOK_URL,
        VoiceMethod: "POST",
        FriendlyName: `Pathir - ${practice.name}`,
      });

      if (!purchased.sid) {
        return res.status(500).json({ message: purchased.message || "Failed to purchase number" });
      }
      phoneNumber = purchased.phone_number;
    }

    // Save to DB
    await adminClient
      .from("practices")
      .update({ twilio_phone_number: phoneNumber })
      .eq("id", practiceId);

    return res.json({ phoneNumber, message: "Number assigned successfully" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
