import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const VAPI_WEBHOOK_URL = "https://api.vapi.ai/twilio/inbound_call";
const SMS_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/twilio-sms-webhook`;

const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);

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

function detectAreaCode(address: string | null) {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const entry of UK_AREA_CODES) {
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) return entry;
    }
  }
  return null;
}

async function twilioGet(path: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`, {
    headers: { Authorization: `Basic ${twilioAuth}` },
  });
  return res.json();
}

async function twilioPost(path: string, body: Record<string, string>) {
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

async function twilioPostUrl(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${twilioAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

/** Truncate practice name to a valid alpha sender (max 11 chars, alphanumeric + space). */
function toAlphaSender(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  return clean.slice(0, 11).trimEnd() || "Pathir";
}

async function findPooledNumber(areaCode: string | null, assignedNumbers: Set<string>) {
  const data = await twilioGet("/IncomingPhoneNumbers.json?PageSize=100");
  const allNumbers = data.incoming_phone_numbers || [];

  if (areaCode) {
    const e164Prefix = "+44" + areaCode.replace(/^0/, "");
    const pooled = allNumbers.filter(
      (n: any) => !assignedNumbers.has(n.phone_number) && n.phone_number.startsWith(e164Prefix)
    );
    if (pooled.length > 0) return pooled[0];
  }

  const anyPooled = allNumbers.filter((n: any) => !assignedNumbers.has(n.phone_number));
  return anyPooled.length > 0 ? anyPooled[0] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ message: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a client with the user's token to verify ownership
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { practiceId } = await req.json();
    if (!practiceId) {
      return new Response(JSON.stringify({ message: "practiceId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client for DB operations
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the user owns this practice
    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("*")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return new Response(JSON.stringify({ message: "Practice not found or not owned by you" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (practice.twilio_phone_number) {
      return new Response(
        JSON.stringify({ phoneNumber: practice.twilio_phone_number, message: "Already assigned" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all currently assigned numbers
    const { data: allPractices } = await adminClient
      .from("practices")
      .select("twilio_phone_number");

    const assignedNumbers = new Set(
      (allPractices || []).map((p: any) => p.twilio_phone_number).filter(Boolean)
    );

    // Detect area code from practice address
    const match = detectAreaCode(practice.address);
    const poolAreaCode = match ? match.areaCode : null;

    // Check pool first
    let phoneNumber: string | null = null;
    const pooled = await findPooledNumber(poolAreaCode, assignedNumbers);

    if (pooled) {
      phoneNumber = pooled.phone_number;
      await twilioPost(`/IncomingPhoneNumbers/${pooled.sid}.json`, {
        VoiceUrl: VAPI_WEBHOOK_URL,
        VoiceMethod: "POST",
        FriendlyName: `Pathir - ${practice.name}`,
      });
    }

    // If no pooled number, try to buy one
    if (!phoneNumber) {
      let available: any[] = [];

      if (match) {
        const e164Prefix = "+44" + match.areaCode.replace(/^0/, "");
        const data = await twilioGet(
          `/AvailablePhoneNumbers/GB/Local.json?Contains=${encodeURIComponent(e164Prefix)}&PageSize=5&VoiceEnabled=true`
        );
        available = data.available_phone_numbers || [];
      }

      if (available.length === 0) {
        const data = await twilioGet(
          `/AvailablePhoneNumbers/GB/Local.json?PageSize=5&VoiceEnabled=true`
        );
        available = data.available_phone_numbers || [];
      }

      if (available.length === 0) {
        return new Response(
          JSON.stringify({ message: "No UK numbers available on Twilio" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const purchased = await twilioPost("/IncomingPhoneNumbers.json", {
        PhoneNumber: available[0].phone_number,
        VoiceUrl: VAPI_WEBHOOK_URL,
        VoiceMethod: "POST",
        FriendlyName: `Pathir - ${practice.name}`,
      });

      if (!purchased.sid) {
        return new Response(
          JSON.stringify({ message: purchased.message || "Failed to purchase number" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      phoneNumber = purchased.phone_number;
    }

    // Save voice number to practice
    await adminClient
      .from("practices")
      .update({ twilio_phone_number: phoneNumber })
      .eq("id", practiceId);

    // ── Auto-provision SMS Phase 1: Messaging Service + alpha sender ──
    // No mobile number needed — outbound SMS works with alpha sender only.
    // Phase 2 (mobile number for two-way SMS) requires Twilio regulatory bundle.
    let messagingServiceSid: string | null = null;
    let alphaSender: string | null = null;
    try {
      const svc = await twilioPostUrl("https://messaging.twilio.com/v1/Services", {
        FriendlyName: `Pathir - ${practice.name}`,
        InboundRequestUrl: SMS_WEBHOOK_URL,
        InboundMethod: "POST",
        StickySender: "true",
      });

      if (svc.sid) {
        messagingServiceSid = svc.sid;
        alphaSender = toAlphaSender(practice.name);

        // Add alpha sender (practice name shows on patient's phone)
        await twilioPostUrl(
          `https://messaging.twilio.com/v1/Services/${svc.sid}/AlphaSenders`,
          { AlphaSender: alphaSender },
        );

        await adminClient
          .from("practices")
          .update({ messaging_service_sid: messagingServiceSid })
          .eq("id", practiceId);
      }
    } catch (smsErr) {
      console.error("[ASSIGN] SMS provisioning failed (non-fatal):", smsErr);
    }

    // ── Register phone number with ElevenLabs agent ──
    let elevenlabsRegistered = false;
    if (practice.elevenlabs_agent_id && ELEVENLABS_API_KEY) {
      try {
        const elRes = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers/create", {
          method: "POST",
          headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            phone_number: phoneNumber,
            provider: "twilio",
            label: `Pathir - ${practice.name}`,
            agent_id: practice.elevenlabs_agent_id,
            twilio_config: { account_sid: TWILIO_SID, auth_token: TWILIO_TOKEN },
          }),
        });
        elevenlabsRegistered = elRes.ok;
        if (!elRes.ok) console.error("[ASSIGN] ElevenLabs phone registration failed:", await elRes.text());
        else console.log("[ASSIGN] Phone registered with ElevenLabs agent:", practice.elevenlabs_agent_id);
      } catch (elErr) {
        console.error("[ASSIGN] ElevenLabs registration error (non-fatal):", elErr);
      }
    } else if (!practice.elevenlabs_agent_id) {
      console.warn("[ASSIGN] No elevenlabs_agent_id — phone registered in Twilio only. Provision agent first.");
    }

    return new Response(
      JSON.stringify({
        phoneNumber,
        messagingServiceSid,
        alphaSender,
        elevenlabsRegistered,
        message: "Number assigned successfully",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
