/**
 * Purpose:  Send an outbound SMS from a practice. Routes via Twilio or
 *           TextMagic depending on the practice's `integrations.sms_provider`
 *           setting — see _shared/sms.ts.
 *
 * Dependencies: Supabase (practices table), _shared/sms.ts, _shared/cors.ts
 * Used by:      Dashboard, appointment reminder system, enquiry replies
 * Changes:      2026-04-24  Switch to _shared/sms.ts provider abstraction.
 *               2026-03-19  Initial implementation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendSms, SmsError } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    const { practiceId, to, body } = await req.json();

    if (!practiceId || !to || !body) {
      return new Response(
        JSON.stringify({ message: "practiceId, to, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: practice, error: practiceError } = await adminClient
      .from("practices")
      .select(
        "id, name, integrations, messaging_service_sid, twilio_sms_number, twilio_phone_number, owner_id",
      )
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (practiceError || !practice) {
      return new Response(
        JSON.stringify({ message: "Practice not found or not owned by you" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    try {
      const result = await sendSms(practice, to, body);
      console.log(
        `[SEND SMS] ${practice.name} via ${result.provider} | to=${result.to} | id=${result.messageId} | status=${result.status}`,
      );
      return new Response(
        JSON.stringify({
          provider: result.provider,
          messageSid: result.messageId,
          status: result.status,
          from: result.from,
          to: result.to,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      if (e instanceof SmsError) {
        console.error(`[SEND SMS] ${e.provider} error:`, e.message, e.providerCode);
        return new Response(
          JSON.stringify({
            message: e.message,
            provider: e.provider,
            code: e.providerCode,
          }),
          { status: e.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw e;
    }
  } catch (err) {
    console.error("[SEND SMS ERROR]", err);
    return new Response(
      JSON.stringify({ message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
