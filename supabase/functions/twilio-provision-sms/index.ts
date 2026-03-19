/**
 * Purpose:  Provision SMS capability for a practice.
 *           1. Buys a UK mobile number (SMS-capable)
 *           2. Creates a Twilio Messaging Service
 *           3. Adds an alpha sender (practice name, max 11 chars) to the service
 *           4. Adds the mobile number to the service sender pool
 *           5. Sets the SmsUrl on the mobile number for inbound SMS
 *           6. Saves twilio_sms_number + messaging_service_sid to the database
 *
 * Dependencies: Twilio API, Supabase (practices table)
 * Used by:      Admin provisioning, twilio-assign-number (auto-provision)
 * Changes:      2026-03-19  Initial implementation
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMS_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/twilio-sms-webhook`;

const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);

async function twilioGet(path: string) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`,
    { headers: { Authorization: `Basic ${twilioAuth}` } },
  );
  return res.json();
}

async function twilioPost(url: string, body: Record<string, string>) {
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
  // Strip non-alphanumeric chars (keep spaces)
  const clean = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  // Take first 11 chars, trim trailing space
  return clean.slice(0, 11).trimEnd() || "Pathir";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { practiceId, adminMode } = await req.json();
    if (!practiceId) {
      return new Response(
        JSON.stringify({ message: "practiceId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch practice
    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("id, name, twilio_phone_number, twilio_sms_number, messaging_service_sid")
      .eq("id", practiceId)
      .single();

    if (practiceError || !practice) {
      return new Response(
        JSON.stringify({ message: "Practice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Skip if already provisioned
    if (practice.twilio_sms_number && practice.messaging_service_sid) {
      return new Response(
        JSON.stringify({
          message: "Already provisioned",
          smsNumber: practice.twilio_sms_number,
          messagingServiceSid: practice.messaging_service_sid,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const steps: string[] = [];

    // ── Step 1: Buy a UK mobile number ──
    let smsNumber = practice.twilio_sms_number;
    let smsNumberSid = "";

    if (!smsNumber) {
      console.error(`[PROVISION SMS] Buying UK mobile number for ${practice.name}`);

      const available = await twilioGet(
        "/AvailablePhoneNumbers/GB/Mobile.json?SmsEnabled=true&VoiceEnabled=true&PageSize=5",
      );
      const numbers = available.available_phone_numbers || [];

      if (numbers.length === 0) {
        return new Response(
          JSON.stringify({ message: "No SMS-capable UK mobile numbers available" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const purchased = await twilioPost(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers.json`,
        {
          PhoneNumber: numbers[0].phone_number,
          SmsUrl: SMS_WEBHOOK_URL,
          SmsMethod: "POST",
          FriendlyName: `Pathir SMS - ${practice.name}`,
        },
      );

      if (!purchased.sid) {
        return new Response(
          JSON.stringify({ message: purchased.message || "Failed to buy mobile number" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      smsNumber = purchased.phone_number;
      smsNumberSid = purchased.sid;
      steps.push(`Bought ${smsNumber}`);
    } else {
      // Number exists but no messaging service — look up its SID
      const encoded = encodeURIComponent(smsNumber);
      const search = await twilioGet(`/IncomingPhoneNumbers.json?PhoneNumber=${encoded}`);
      smsNumberSid = (search.incoming_phone_numbers || [])[0]?.sid || "";
      steps.push(`Using existing ${smsNumber}`);
    }

    // ── Step 2: Create Messaging Service ──
    let serviceSid = practice.messaging_service_sid;

    if (!serviceSid) {
      console.error(`[PROVISION SMS] Creating Messaging Service for ${practice.name}`);

      const svc = await twilioPost("https://messaging.twilio.com/v1/Services", {
        FriendlyName: `Pathir - ${practice.name}`,
        InboundRequestUrl: SMS_WEBHOOK_URL,
        InboundMethod: "POST",
        StickySender: "true",
      });

      if (!svc.sid) {
        return new Response(
          JSON.stringify({ message: svc.message || "Failed to create Messaging Service" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      serviceSid = svc.sid;
      steps.push(`Created Messaging Service ${serviceSid}`);
    } else {
      steps.push(`Using existing service ${serviceSid}`);
    }

    // ── Step 3: Add alpha sender to the Messaging Service ──
    const alphaSenderName = toAlphaSender(practice.name);
    console.error(`[PROVISION SMS] Adding alpha sender "${alphaSenderName}" to ${serviceSid}`);

    const alpha = await twilioPost(
      `https://messaging.twilio.com/v1/Services/${serviceSid}/AlphaSenders`,
      { AlphaSender: alphaSenderName },
    );

    if (alpha.sid) {
      steps.push(`Added alpha sender "${alphaSenderName}"`);
    } else {
      // May already exist — not fatal
      steps.push(`Alpha sender note: ${alpha.message || "may already exist"}`);
    }

    // ── Step 4: Add the mobile number to the Messaging Service sender pool ──
    if (smsNumberSid) {
      console.error(`[PROVISION SMS] Adding ${smsNumber} to service ${serviceSid}`);

      const phoneAdd = await twilioPost(
        `https://messaging.twilio.com/v1/Services/${serviceSid}/PhoneNumbers`,
        { PhoneNumberSid: smsNumberSid },
      );

      if (phoneAdd.sid) {
        steps.push(`Added ${smsNumber} to sender pool`);
      } else {
        steps.push(`Phone pool note: ${phoneAdd.message || "may already exist"}`);
      }
    }

    // ── Step 5: Save to database ──
    const { error: updateError } = await adminClient
      .from("practices")
      .update({
        twilio_sms_number: smsNumber,
        messaging_service_sid: serviceSid,
      })
      .eq("id", practiceId);

    if (updateError) {
      console.error(`[PROVISION SMS] DB update error:`, updateError);
      steps.push(`DB update failed: ${updateError.message}`);
    } else {
      steps.push("Saved to database");
    }

    return new Response(
      JSON.stringify({
        smsNumber,
        messagingServiceSid: serviceSid,
        alphaSender: alphaSenderName,
        steps,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[PROVISION SMS ERROR]", err);
    return new Response(
      JSON.stringify({ message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
