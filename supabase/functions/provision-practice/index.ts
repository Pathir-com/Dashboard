/**
 * Provision an ElevenLabs agent for a new practice.
 * Called after onboarding creates the practice row.
 *
 * Creates an ElevenLabs agent with:
 * - Same voice (Scottish female TVmbglAk3F1GkiCoOq47)
 * - Practice-specific system prompt (clinic name)
 * - All 6 tool webhooks pointing to our Supabase functions
 * - Post-conversation webhook for transcript sync
 *
 * Stores the agent_id on the practice row.
 *
 * Auth: JWT required (user must own the practice).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { generateSystemPrompt, buildToolDefinitions } from "../_shared/agent-config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { practiceId } = await req.json();
    if (!practiceId) return new Response(JSON.stringify({ error: "practiceId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify ownership
    const { data: practice, error: pErr } = await adminClient
      .from("practices").select("id, name, elevenlabs_agent_id, owner_id")
      .eq("id", practiceId).eq("owner_id", user.id).single();

    if (pErr || !practice) return new Response(JSON.stringify({ error: "Practice not found or not owned by you" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Already provisioned?
    if (practice.elevenlabs_agent_id) {
      return new Response(JSON.stringify({ success: true, agent_id: practice.elevenlabs_agent_id, message: "Agent already exists" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create ElevenLabs agent
    const systemPrompt = generateSystemPrompt(practice.name, "Poppy");
    const tools = buildToolDefinitions(FUNCTIONS_URL);

    const agentPayload = {
      name: `Poppy - ${practice.name}`,
      conversation_config: {
        agent: {
          prompt: {
            prompt: systemPrompt,
            llm: "gpt-4o",
            tools,
          },
          first_message: `Hello... welcome to ${practice.name}, Poppy speaking. How can I help you today?`,
          language: "en",
        },
        tts: {
          voice_id: "TVmbglAk3F1GkiCoOq47",
          model_id: "eleven_turbo_v2",
          optimize_streaming_latency: 3,
          stability: 0.5,
          speed: 1,
          similarity_boost: 0.75,
        },
        turn: {
          turn_timeout: 15,
          turn_eagerness: "normal",
        },
        conversation: {
          max_duration_seconds: 600,
        },
      },
    };

    console.log(`[PROVISION] Creating ElevenLabs agent for ${practice.name}...`);

    const elRes = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(agentPayload),
    });

    if (!elRes.ok) {
      const errBody = await elRes.text();
      console.error(`[PROVISION] ElevenLabs agent creation failed: ${elRes.status} ${errBody}`);
      return new Response(JSON.stringify({ error: "Failed to create AI agent", details: errBody }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const agentData = await elRes.json();
    const agentId = agentData.agent_id;

    if (!agentId) {
      console.error("[PROVISION] No agent_id in response:", agentData);
      return new Response(JSON.stringify({ error: "Agent created but no ID returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Store agent_id on practice
    await adminClient.from("practices").update({ elevenlabs_agent_id: agentId }).eq("id", practiceId);

    console.log(`[PROVISION] Agent ${agentId} created for ${practice.name}`);

    return new Response(JSON.stringify({
      success: true,
      agent_id: agentId,
      practice_name: practice.name,
      message: `AI agent "Poppy" provisioned for ${practice.name}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[PROVISION ERROR]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
