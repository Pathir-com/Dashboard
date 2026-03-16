/**
 * Purpose:
 *   Supabase Edge Function that returns a signed WebSocket URL for
 *   ElevenLabs Conversational AI. Keeps the API key server-side so the
 *   embeddable widget never exposes credentials.
 *
 *   GET  — original flow: agent_id from query param, returns signed_url + practice_id
 *   POST — new flow: accepts identity fields, performs contact matching,
 *          returns signed_url + practice_id + contact matching result
 *
 * Dependencies:
 *   - ElevenLabs REST API (GET /v1/convai/conversation/get_signed_url)
 *   - ELEVENLABS_API_KEY environment variable (Supabase secret)
 *   - _shared/match-contact.ts (matchContactByIdentity)
 *
 * Used by:
 *   - public/pathir-chat.js (embeddable chat widget)
 *
 * Changes:
 *   2026-03-16: Accept POST with identity fields for contact matching.
 *   2026-03-11: Added practice_id lookup so widget can pass it as dynamic variable.
 *   2026-03-11: Initial creation — signed URL proxy for the chat widget.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchContactByIdentity } from "../_shared/match-contact.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

serve(async (req: Request) => {
  /* Handle CORS preflight */
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  /* ── Parse agent_id from GET query or POST body ── */
  let agentId: string | null = null;
  let visitorName: string | undefined;
  let visitorDob: string | undefined;
  let visitorPostcode: string | undefined;
  let visitorPhone: string | undefined;

  if (req.method === "POST") {
    try {
      const body = await req.json();
      agentId = body.agent_id || null;
      visitorName = body.visitor_name;
      visitorDob = body.visitor_dob;
      visitorPostcode = body.visitor_postcode;
      visitorPhone = body.visitor_phone;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: JSON_HEADERS },
      );
    }
  } else {
    const url = new URL(req.url);
    agentId = url.searchParams.get("agent_id");
  }

  if (!agentId) {
    return new Response(
      JSON.stringify({ error: "agent_id is required" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) {
    console.error("[chat-token] ELEVENLABS_API_KEY not set");
    return new Response(
      JSON.stringify({ error: "Server misconfiguration" }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  /* ── Fetch a signed WebSocket URL from ElevenLabs ── */
  const elUrl = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`;
  const elResp = await fetch(elUrl, {
    headers: { "xi-api-key": apiKey },
  });

  if (!elResp.ok) {
    const body = await elResp.text();
    console.error(`[chat-token] ElevenLabs responded ${elResp.status}: ${body}`);
    return new Response(
      JSON.stringify({ error: "Failed to obtain signed URL" }),
      { status: elResp.status, headers: JSON_HEADERS },
    );
  }

  const data = await elResp.json();

  /* ── Look up the practice_id ── */
  let practiceId: string | null = null;
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: practice } = await db
      .from("practices")
      .select("id")
      .eq("elevenlabs_agent_id", agentId)
      .single();
    practiceId = practice?.id || null;
  } catch { /* non-critical */ }

  /* ── Contact matching (POST only, when identity fields provided) ── */
  let contactId: string | null = null;
  let isReturningPatient = false;
  let ambiguous = false;

  if (req.method === "POST" && practiceId && visitorName && visitorDob && visitorPostcode) {
    try {
      const result = await matchContactByIdentity(db, {
        practiceId,
        name: visitorName,
        dob: visitorDob,
        postcode: visitorPostcode,
        phone: visitorPhone,
      });

      if (result.match === "exact" && result.contact) {
        contactId = result.contact.id;
        isReturningPatient = true;
      } else if (result.match === "ambiguous") {
        ambiguous = true;
      }
    } catch (err) {
      console.error("[chat-token] Contact matching failed:", err);
    }
  }

  return new Response(JSON.stringify({
    ...data,
    practice_id: practiceId,
    contact_id: contactId,
    is_returning_patient: isReturningPatient,
    ambiguous,
  }), {
    headers: JSON_HEADERS,
  });
});
