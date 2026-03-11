/**
 * Purpose:
 *   ElevenLabs post-conversation webhook handler. Fires when a phone call
 *   or web chat session ends. Stores the transcript, AI-generated summary,
 *   and outcome classification in the conversations table for RAG retrieval.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/cors.ts
 *   - conversations table (005_conversations.sql)
 *
 * Used by:
 *   - ElevenLabs agent webhook (post-call URL)
 *
 * Changes:
 *   2026-03-11: Initial creation — transcript + summary storage.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawText = await req.text();
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    /* Log the raw payload for debugging — store it in a conversation record's metadata */
    let rawBody;
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      console.error("[ELEVENLABS CONVERSATION] Failed to parse JSON:", rawText.slice(0, 500));
      return new Response(
        JSON.stringify({ success: false, message: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /* ElevenLabs may wrap the payload under a 'data' key or send it flat.
       Handle both structures gracefully. */
    // deno-lint-ignore no-explicit-any
    const body = (rawBody as any).data || rawBody;

    console.error("[ELEVENLABS CONVERSATION] Top-level keys:", JSON.stringify(Object.keys(rawBody)));
    console.error("[ELEVENLABS CONVERSATION] conversation_id:", body.conversation_id);

    const conversationId = body.conversation_id;
    const transcript = body.transcript || [];
    const analysis = body.analysis || {};
    const metadata = body.metadata || {};

    if (!conversationId) {
      console.error("[ELEVENLABS CONVERSATION] No conversation_id. Raw keys:", Object.keys(rawBody));
      return new Response(
        JSON.stringify({ success: false, message: "No conversation_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Format transcript for storage: [{role, content, timestamp}]
    const formattedTranscript = transcript.map((t: {
      role: string; message: string; time_in_call_secs?: number;
    }) => ({
      role: t.role,
      content: t.message,
      timestamp: t.time_in_call_secs || 0,
    }));

    // Extract summary from analysis (ElevenLabs generates this automatically)
    const summary = analysis.summary
      || analysis.call_summary
      || generateSimpleSummary(formattedTranscript);

    // Determine outcome from analysis or transcript content
    const outcome = classifyOutcome(analysis, formattedTranscript);

    const callDuration = metadata.call_duration_secs
      || metadata.duration
      || (transcript.length > 0
        ? Math.ceil(transcript[transcript.length - 1]?.time_in_call_secs || 0)
        : null);

    /* Try to find the conversation record created during the call.
       Path 1: match by elevenlabs_conversation_id (set if system-provided worked).
       Path 2: fallback — find the most recent 'active' conversation for this
       practice, which was created by lookup_caller_phone / lookup_web_visitor. */
    let existing = null;

    const { data: byElId } = await db
      .from("conversations")
      .select("id")
      .eq("elevenlabs_conversation_id", conversationId)
      .single();
    existing = byElId;

    if (!existing) {
      /* Fallback: find the most recent conversation for this practice that
         does NOT yet have an elevenlabs_conversation_id set. This is the one
         created by lookup_caller_phone / lookup_web_visitor during the call.
         We order by created_at DESC so the newest session is matched first. */
      const agentId = body.agent_id;
      if (agentId) {
        const { data: practice } = await db
          .from("practices")
          .select("id")
          .eq("elevenlabs_agent_id", agentId)
          .single();
        if (practice) {
          const { data: recent } = await db
            .from("conversations")
            .select("id")
            .eq("practice_id", practice.id)
            .is("elevenlabs_conversation_id", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          existing = recent;
        }
      }
    }

    if (existing) {
      // Update the existing row with transcript, summary, and ElevenLabs ID
      await db.from("conversations").update({
        elevenlabs_conversation_id: conversationId,
        status: body.status === "error" ? "error" : "completed",
        outcome,
        summary,
        transcript: formattedTranscript,
        ended_at: new Date().toISOString(),
        duration_seconds: callDuration ? Math.round(callDuration) : null,
        metadata: {
          analysis: analysis.data_collection || null,
          el_status: body.status || null,
        },
      }).eq("id", existing.id);
    } else {
      /*
       * No existing row — the conversation wasn't matched during the call
       * (e.g. identity tool was never called). Create a new row from the
       * agent_id to at least capture the transcript.
       */
      const agentId = body.agent_id;
      let practiceId = null;
      if (agentId) {
        const { data: practice } = await db
          .from("practices")
          .select("id")
          .eq("elevenlabs_agent_id", agentId)
          .single();
        practiceId = practice?.id || null;
      }

      if (practiceId) {
        await db.from("conversations").insert({
          practice_id: practiceId,
          elevenlabs_conversation_id: conversationId,
          channel: "phone",
          status: body.status === "error" ? "error" : "completed",
          outcome,
          summary,
          transcript: formattedTranscript,
          ended_at: new Date().toISOString(),
          duration_seconds: callDuration ? Math.round(callDuration) : null,
          metadata: {
            analysis: analysis.data_collection || null,
            el_status: body.status || null,
          },
        });
      }
    }

    /* Also update the linked enquiry so the dashboard shows the conversation
       and summary. The dashboard reads enquiries.conversation (JSONB array of
       {role, message, timestamp}) and enquiries.message for the summary text. */
    if (existing) {
      const { data: conv } = await db
        .from("conversations")
        .select("enquiry_id")
        .eq("id", existing.id)
        .single();

      if (conv?.enquiry_id) {
        // Convert transcript to the format the dashboard expects:
        // [{role: 'patient'|'clinic', message: '...', timestamp: '...'}]
        const dashboardConversation = formattedTranscript.map((t: {
          role: string; content: string; timestamp: number;
        }) => ({
          role: t.role === "user" ? "patient" : "clinic",
          message: t.content,
          timestamp: new Date(
            (metadata.start_time ? new Date(metadata.start_time).getTime() : Date.now())
            + (t.timestamp || 0) * 1000
          ).toISOString(),
        }));

        const enquiryUpdate: Record<string, unknown> = {
          conversation: dashboardConversation,
        };
        // Only update message if there's no appointment already set
        // (request_appointment sets a more specific message)
        if (summary) {
          const { data: enq } = await db
            .from("enquiries").select("appointment_status")
            .eq("id", conv.enquiry_id).single();
          if (!enq?.appointment_status) {
            enquiryUpdate.message = summary;
          }
        }

        await db.from("enquiries").update(enquiryUpdate).eq("id", conv.enquiry_id);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ELEVENLABS CONVERSATION]", err);
    return new Response(
      JSON.stringify({ success: false, message: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Fallback summary when ElevenLabs analysis isn't available.
 * Extracts the first user message and agent response as a brief summary.
 */
function generateSimpleSummary(
  transcript: Array<{ role: string; content: string }>,
): string {
  if (transcript.length === 0) return "Conversation with no transcript.";

  const firstUser = transcript.find((t) => t.role === "user");
  if (!firstUser) return "Agent-only interaction (no user messages).";

  // Take the first meaningful user message (skip very short ones)
  const userMessages = transcript
    .filter((t) => t.role === "user" && t.content.length > 5)
    .slice(0, 3);

  if (userMessages.length === 0) return "Brief interaction, no substantial user input.";

  return `Patient said: "${userMessages[0].content}"${
    userMessages.length > 1 ? ` (+ ${userMessages.length - 1} more messages)` : ""
  }`;
}

/**
 * Classify the conversation outcome from analysis data or transcript keywords.
 */
function classifyOutcome(
  // deno-lint-ignore no-explicit-any
  analysis: any,
  transcript: Array<{ role: string; content: string }>,
): string | null {
  // Check ElevenLabs analysis first
  if (analysis.outcome) {
    const o = analysis.outcome.toLowerCase();
    if (o.includes("book") || o.includes("appointment")) return "booking_made";
    if (o.includes("callback") || o.includes("call back")) return "callback_requested";
    if (o.includes("transfer")) return "transferred";
    return "enquiry_only";
  }

  // Fallback: scan agent messages for booking confirmation language
  const agentText = transcript
    .filter((t) => t.role === "agent")
    .map((t) => t.content.toLowerCase())
    .join(" ");

  if (agentText.includes("pencilled") || agentText.includes("booked")) return "booking_made";
  if (agentText.includes("call you back") || agentText.includes("callback")) return "callback_requested";
  if (agentText.includes("transfer") || agentText.includes("put you through")) return "transferred";

  return "enquiry_only";
}
