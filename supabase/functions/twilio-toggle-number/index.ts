/**
 * Purpose:  Toggle a practice's phone agent on or off without releasing the
 *           Twilio number. "Disconnect" reroutes inbound calls to a
 *           disconnected-voice message; "reconnect" restores VAPI routing.
 *
 * Dependencies: Twilio API, Supabase (practices table)
 * Used by:      Dashboard IntegrationsTab (phone_enabled toggle)
 * Changes:      2026-03-18  Initial implementation — replaces twilio-release-number
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPI_WEBHOOK_URL = "https://api.vapi.ai/twilio/inbound_call";
const DISCONNECTED_VOICE_URL = `${SUPABASE_URL}/functions/v1/twilio-disconnected-voice`;

const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);

async function twilioGet(path: string) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`,
    { headers: { Authorization: `Basic ${twilioAuth}` } },
  );
  return res.json();
}

async function twilioPost(path: string, body: Record<string, string>) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    },
  );
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ message: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // ── Parse body ──
    const { practiceId, enable } = await req.json();
    if (!practiceId) {
      return new Response(JSON.stringify({ message: "practiceId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof enable !== "boolean") {
      return new Response(JSON.stringify({ message: "enable (boolean) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Admin client ──
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Verify ownership ──
    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("id, name, twilio_phone_number, integrations, owner_id")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return new Response(JSON.stringify({ message: "Practice not found or not owned by you" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!practice.twilio_phone_number) {
      return new Response(JSON.stringify({ message: "No phone number assigned to this practice" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Look up the Twilio IncomingPhoneNumber by phone number ──
    const encoded = encodeURIComponent(practice.twilio_phone_number);
    const searchData = await twilioGet(`/IncomingPhoneNumbers.json?PhoneNumber=${encoded}`);
    const twilioNumbers = searchData.incoming_phone_numbers || [];

    if (twilioNumbers.length === 0) {
      return new Response(
        JSON.stringify({ message: "Phone number not found in Twilio account" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const twilioNumber = twilioNumbers[0];

    // ── Update Twilio VoiceUrl ──
    const newVoiceUrl = enable ? VAPI_WEBHOOK_URL : DISCONNECTED_VOICE_URL;

    await twilioPost(`/IncomingPhoneNumbers/${twilioNumber.sid}.json`, {
      VoiceUrl: newVoiceUrl,
      VoiceMethod: "POST",
    });

    // ── Update integrations.phone_enabled in the database ──
    const updatedIntegrations = {
      ...(practice.integrations || {}),
      phone_enabled: enable,
    };

    await adminClient
      .from("practices")
      .update({ integrations: updatedIntegrations })
      .eq("id", practiceId);

    return new Response(
      JSON.stringify({
        phoneNumber: practice.twilio_phone_number,
        enabled: enable,
        message: enable ? "Phone agent reconnected" : "Phone agent disconnected",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
