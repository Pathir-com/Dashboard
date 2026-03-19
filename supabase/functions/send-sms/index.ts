/**
 * Purpose:  Send an outbound SMS from a practice via its Messaging Service.
 *           Uses the alpha sender (practice name) for outbound messages.
 *           Falls back to direct Twilio API if no Messaging Service is configured.
 *
 * Dependencies: Twilio API, Supabase (practices table)
 * Used by:      Dashboard, appointment reminder system, enquiry replies
 * Changes:      2026-03-19  Initial implementation
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ message: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Parse body ──
    const { practiceId, to, body } = await req.json();

    if (!practiceId || !to || !body) {
      return new Response(
        JSON.stringify({ message: "practiceId, to, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Verify ownership ──
    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select("id, name, messaging_service_sid, twilio_sms_number, twilio_phone_number, owner_id")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return new Response(
        JSON.stringify({ message: "Practice not found or not owned by you" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build Twilio message params ──
    const params: Record<string, string> = {
      To: to,
      Body: body,
    };

    if (practice.messaging_service_sid) {
      // Use Messaging Service (sends with alpha sender name)
      params.MessagingServiceSid = practice.messaging_service_sid;
    } else if (practice.twilio_sms_number) {
      // Fallback: send from the SMS mobile number directly
      params.From = practice.twilio_sms_number;
    } else {
      return new Response(
        JSON.stringify({ message: "SMS not configured for this practice. No Messaging Service or SMS number found." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Send via Twilio ──
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params).toString(),
      },
    );

    const result = await res.json();

    if (!res.ok) {
      console.error("[SEND SMS] Twilio error:", JSON.stringify(result));
      return new Response(
        JSON.stringify({
          message: result.message || "Failed to send SMS",
          code: result.code,
        }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[SEND SMS] Sent to ${to} from ${practice.name} | SID: ${result.sid} | Status: ${result.status}`);

    return new Response(
      JSON.stringify({
        messageSid: result.sid,
        status: result.status,
        from: result.from || practice.name,
        to: result.to,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[SEND SMS ERROR]", err);
    return new Response(
      JSON.stringify({ message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
