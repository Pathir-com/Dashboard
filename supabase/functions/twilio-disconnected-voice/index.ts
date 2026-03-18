/**
 * Purpose:  Handle inbound calls when the phone agent is disconnected.
 *           Returns TwiML telling the caller the automated receptionist
 *           is unavailable and to contact the practice directly.
 *
 * Dependencies: Supabase (practices table lookup)
 * Used by:      Twilio webhook — VoiceUrl on disconnected numbers
 * Changes:      2026-03-18  Initial implementation
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Build a TwiML <Response> with a spoken message. */
function twimlSay(message: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `  <Say voice="Polly.Amy" language="en-GB">${message}</Say>`,
    "</Response>",
  ].join("\n");
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Twilio sends inbound-call webhooks as POST with form-encoded body
    const formData = await req.formData();
    const toNumber = formData.get("To") as string | null;

    let practiceName: string | null = null;

    if (toNumber) {
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: practice } = await adminClient
        .from("practices")
        .select("name")
        .eq("twilio_phone_number", toNumber)
        .single();

      if (practice) {
        practiceName = practice.name;
      }
    }

    // Build the spoken message
    const message = practiceName
      ? `Thank you for calling ${practiceName}. Our automated receptionist is not currently available on this number. Please visit our website or call the practice directly during opening hours. Goodbye.`
      : "This number is not currently active. Goodbye.";

    return new Response(twimlSay(message), {
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (err) {
    // Even on error, return valid TwiML so the caller hears something
    const fallback =
      "We are sorry, this number is temporarily unavailable. Please try again later. Goodbye.";
    return new Response(twimlSay(fallback), {
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  }
});
