/**
 * Purpose:  Provision SMS capability for a practice (two-phase).
 *
 *   Phase 1 (immediate — no regulatory bundle needed):
 *     1. Create a Twilio Messaging Service
 *     2. Add alpha sender (practice name) — outbound-only, patients see
 *        "Spark Dental" as the sender but can't reply
 *     3. Save messaging_service_sid to database
 *
 *   Phase 2 (after Twilio regulatory bundle is approved):
 *     Pass { addMobileNumber: true } to also:
 *     4. Buy a UK mobile number
 *     5. Add it to the Messaging Service sender pool
 *     6. Configure inbound SMS webhook — enables two-way SMS
 *     7. Save twilio_sms_number to database
 *
 * Dependencies: Twilio API, Supabase (practices table)
 * Used by:      Admin provisioning, twilio-assign-number (auto-provision)
 * Changes:
 *   2026-03-19  Rework: Phase 1 alpha-sender-only (no mobile number needed),
 *               Phase 2 adds mobile number for two-way SMS.
 *   2026-03-19  Initial implementation
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
  const clean = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  return clean.slice(0, 11).trimEnd() || "Pathir";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { practiceId, addMobileNumber } = await req.json();
    if (!practiceId) {
      return new Response(
        JSON.stringify({ message: "practiceId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    const steps: string[] = [];
    // deno-lint-ignore no-explicit-any
    const dbUpdates: Record<string, any> = {};

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 1: Messaging Service + Alpha Sender (always runs)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let serviceSid = practice.messaging_service_sid;

    if (!serviceSid) {
      console.log(`[PROVISION SMS] Creating Messaging Service for ${practice.name}`);

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
      dbUpdates.messaging_service_sid = serviceSid;
      steps.push(`Created Messaging Service ${serviceSid}`);
    } else {
      steps.push(`Messaging Service already exists: ${serviceSid}`);
    }

    // Add alpha sender (idempotent — Twilio ignores duplicates)
    const alphaSenderName = toAlphaSender(practice.name);
    console.log(`[PROVISION SMS] Adding alpha sender "${alphaSenderName}" to ${serviceSid}`);

    const alpha = await twilioPost(
      `https://messaging.twilio.com/v1/Services/${serviceSid}/AlphaSenders`,
      { AlphaSender: alphaSenderName },
    );

    if (alpha.sid) {
      steps.push(`Alpha sender "${alphaSenderName}" active`);
    } else {
      steps.push(`Alpha sender: ${alpha.message || "already exists"}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 2: UK Mobile Number (only when addMobileNumber=true)
    // Requires approved Twilio regulatory bundle for UK mobile.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let smsNumber = practice.twilio_sms_number || null;

    if (addMobileNumber && !smsNumber) {
      console.log(`[PROVISION SMS] Phase 2: Buying UK mobile number for ${practice.name}`);

      const available = await twilioGet(
        "/AvailablePhoneNumbers/GB/Mobile.json?SmsEnabled=true&PageSize=5",
      );
      const numbers = available.available_phone_numbers || [];

      if (numbers.length === 0) {
        // Regulatory bundle likely not approved — Phase 1 still succeeded
        steps.push("No UK mobile numbers available — regulatory bundle may be needed. Outbound SMS (alpha sender) still works.");
      } else {
        const purchased = await twilioPost(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers.json`,
          {
            PhoneNumber: numbers[0].phone_number,
            SmsUrl: SMS_WEBHOOK_URL,
            SmsMethod: "POST",
            FriendlyName: `Pathir SMS - ${practice.name}`,
          },
        );

        if (purchased.sid) {
          smsNumber = purchased.phone_number;
          dbUpdates.twilio_sms_number = smsNumber;
          steps.push(`Bought mobile number ${smsNumber}`);

          // Add to sender pool for two-way routing
          const phoneAdd = await twilioPost(
            `https://messaging.twilio.com/v1/Services/${serviceSid}/PhoneNumbers`,
            { PhoneNumberSid: purchased.sid },
          );
          if (phoneAdd.sid) {
            steps.push(`Added ${smsNumber} to sender pool — two-way SMS enabled`);
          } else {
            steps.push(`Sender pool: ${phoneAdd.message || "may already exist"}`);
          }
        } else {
          steps.push(`Mobile purchase failed: ${purchased.message || "unknown error"}. Alpha sender still works.`);
        }
      }
    } else if (addMobileNumber && smsNumber) {
      steps.push(`Mobile number already provisioned: ${smsNumber}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Save to database
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (Object.keys(dbUpdates).length > 0) {
      const { error: updateError } = await adminClient
        .from("practices")
        .update(dbUpdates)
        .eq("id", practiceId);

      if (updateError) {
        console.error(`[PROVISION SMS] DB update error:`, updateError);
        steps.push(`DB update failed: ${updateError.message}`);
      } else {
        steps.push("Saved to database");
      }
    }

    const twoWayEnabled = !!smsNumber;

    return new Response(
      JSON.stringify({
        messagingServiceSid: serviceSid,
        alphaSender: alphaSenderName,
        smsNumber: smsNumber || null,
        twoWayEnabled,
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
