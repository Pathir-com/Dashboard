/**
 * Purpose:
 *   Supabase Edge Function that returns a signed WebSocket URL for
 *   ElevenLabs Conversational AI. Keeps the API key server-side so the
 *   embeddable widget never exposes credentials.
 *
 * Dependencies:
 *   - ElevenLabs REST API (GET /v1/convai/conversation/get_signed_url)
 *   - ELEVENLABS_API_KEY environment variable (Supabase secret)
 *
 * Used by:
 *   - public/pathir-chat.js (embeddable chat widget)
 *
 * Changes:
 *   2026-03-11: Added practice_id lookup so widget can pass it as dynamic variable.
 *   2026-03-11: Initial creation — signed URL proxy for the chat widget.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

serve(async (req: Request) => {
  /* Handle CORS preflight */
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent_id");

  if (!agentId) {
    return new Response(
      JSON.stringify({ error: "agent_id query parameter is required" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) {
    console.error("[chat-token] ELEVENLABS_API_KEY not set");
    return new Response(
      JSON.stringify({ error: "Server misconfiguration" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  /* Fetch a signed WebSocket URL from ElevenLabs */
  const elUrl = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`;
  const elResp = await fetch(elUrl, {
    headers: { "xi-api-key": apiKey },
  });

  if (!elResp.ok) {
    const body = await elResp.text();
    console.error(`[chat-token] ElevenLabs responded ${elResp.status}: ${body}`);
    return new Response(
      JSON.stringify({ error: "Failed to obtain signed URL" }),
      { status: elResp.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  const data = await elResp.json();

  /* Look up the practice_id so the widget can pass it as a dynamic variable.
     This lets the agent's tools know which practice the chat belongs to. */
  let practiceId = null;
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: practice } = await db
      .from("practices")
      .select("id")
      .eq("elevenlabs_agent_id", agentId)
      .single();
    practiceId = practice?.id || null;
  } catch { /* non-critical — widget works without it */ }

  return new Response(JSON.stringify({ ...data, practice_id: practiceId }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
