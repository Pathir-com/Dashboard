/**
 * Purpose:
 *   Provision an ElevenLabs agent for a new practice. Loads the system
 *   prompt + first_message + persona name from industry_templates so the
 *   agent matches the practice's vertical (dental / hair_transplant /
 *   future verticals). The database is the source of truth for all
 *   per-vertical content.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - _shared/cors.ts
 *   - _shared/agent-config.ts (tool definitions — vertical-agnostic)
 *   - _shared/industry.ts (loadTemplate + buildAgentConfigForPractice)
 *
 * Used by:
 *   - Onboarding flow after a practice row is created
 *   - Manual re-provisioning if a practice changes industry
 *
 * Auth: JWT required (user must own the practice).
 *
 * Changes:
 *   2026-04-25: Switch to template-driven prompts loaded from
 *               industry_templates instead of the hardcoded dental
 *               Poppy prompt. Pulls practitioners + services so the
 *               prompt knows the team and catalog.
 *   2026-03-11: Initial creation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildToolDefinitions } from "../_shared/agent-config.ts";
import { buildAgentConfigForPractice } from "../_shared/industry.ts";

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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { practiceId, force } = await req.json();
    if (!practiceId) {
      return new Response(JSON.stringify({ error: "practiceId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load practice with the columns the template needs
    const { data: practice, error: pErr } = await db
      .from("practices")
      .select("id, name, owner_id, elevenlabs_agent_id, industry, locations, opening_hours")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (pErr || !practice) {
      return new Response(JSON.stringify({ error: "Practice not found or not owned by you" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already provisioned and not asked to re-provision?
    if (practice.elevenlabs_agent_id && !force) {
      return new Response(JSON.stringify({
        success: true,
        agent_id: practice.elevenlabs_agent_id,
        message: "Agent already exists. Pass {force:true} to re-provision.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load practitioners + services so the system prompt knows the team
    // and catalog. The agent will reference these by name during calls.
    const { data: practitioners } = await db
      .from("practitioners")
      .select("name, title, credentials, services, bio")
      .eq("practice_id", practiceId)
      .order("sort_order", { ascending: true });

    const { data: services } = await db
      .from("services")
      .select("name, category, price_pence, duration_minutes, description")
      .eq("practice_id", practiceId)
      .order("name", { ascending: true });

    const { template, systemPrompt, firstMessage } = await buildAgentConfigForPractice(
      db,
      practice,
      practitioners || [],
      services || [],
    );

    const tools = buildToolDefinitions(FUNCTIONS_URL);

    const agentPayload = {
      name: `${template.agent_persona_name} — ${practice.name}`,
      conversation_config: {
        agent: {
          prompt: { prompt: systemPrompt, llm: "gpt-4o", tools },
          first_message: firstMessage,
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
        turn: { turn_timeout: 15, turn_eagerness: "normal" },
        conversation: { max_duration_seconds: 600 },
      },
      // Allow conversation-time overrides so the per-inbound text-channel
      // path (_shared/ai-reply.ts) can refresh the prompt with live DB
      // data (services, prices, practitioners). System-wide — every new
      // clinic gets this automatically, regardless of vertical.
      platform_settings: {
        overrides: {
          conversation_config_override: {
            agent: { prompt: { prompt: true }, first_message: true, language: true },
            tts: { voice_id: false },
          },
          custom_llm_extra_body: false,
          enable_conversation_initiation_client_data_from_webhook: false,
        },
      },
    };

    console.log(`[PROVISION] Creating ${template.agent_persona_name} agent for ${practice.name} (industry=${practice.industry})...`);

    const elRes = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(agentPayload),
    });

    if (!elRes.ok) {
      const errBody = await elRes.text();
      console.error(`[PROVISION] ElevenLabs agent creation failed: ${elRes.status} ${errBody}`);
      return new Response(JSON.stringify({ error: "Failed to create AI agent", details: errBody }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agentData = await elRes.json();
    const agentId = agentData.agent_id;
    if (!agentId) {
      console.error("[PROVISION] No agent_id in response:", agentData);
      return new Response(JSON.stringify({ error: "Agent created but no ID returned" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await db.from("practices").update({ elevenlabs_agent_id: agentId }).eq("id", practiceId);

    console.log(`[PROVISION] Agent ${agentId} created for ${practice.name}`);

    return new Response(JSON.stringify({
      success: true,
      agent_id: agentId,
      agent_name: template.agent_persona_name,
      industry: template.id,
      practice_name: practice.name,
      message: `${template.agent_persona_name} agent provisioned for ${practice.name}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[PROVISION ERROR]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
