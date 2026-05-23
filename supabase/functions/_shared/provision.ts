/**
 * ensureAgentForPractice — guarantee a practice has a working ElevenLabs
 * ConvAI agent (with a seeded bookable catalog and the current vertical
 * prompt). One place, used by:
 *   - provision-practice (onboarding)
 *   - twilio-assign-number (enabling the phone channel must not produce a
 *     dead number — the agent has to exist for the inbound call to be
 *     answered)
 *   - backfill-practices (heal older practices whose provisioning silently
 *     failed in the fire-and-forget era, e.g. Baker Street)
 *
 * Idempotent: if the practice already has an agent and force!=true, returns
 * it untouched. Otherwise seeds the catalog, builds the prompt from the
 * current industry template, creates the agent, stores the id, returns it.
 *
 * Voice is the chosen Scottish female (TVmbglAk3F1GkiCoOq47 /
 * eleven_turbo_v2), locked via tts.voice_id:false in overrides.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildToolDefinitions, END_CALL_BUILTIN } from "./agent-config.ts";
import { buildAgentConfigForPractice } from "./industry.ts";
import { ensureBookableCatalog } from "./catalog.ts";

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export interface EnsureAgentResult {
  agent_id: string;
  created: boolean;            // true if we created one this call
  persona?: string;
  industry?: string;
  catalog_seeded?: boolean;
}

// deno-lint-ignore no-explicit-any
export async function ensureAgentForPractice(
  db: SupabaseClient,
  // deno-lint-ignore no-explicit-any
  practice: any,
  opts: { force?: boolean } = {},
): Promise<EnsureAgentResult> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

  if (practice.elevenlabs_agent_id && !opts.force) {
    return { agent_id: practice.elevenlabs_agent_id, created: false };
  }

  // Seed a bookable catalog first so the agent's prompt has the team + menu.
  const seeded = await ensureBookableCatalog(db, practice);

  const [{ data: practitioners }, { data: services }] = await Promise.all([
    db.from("practitioners").select("name, title, credentials, services, bio")
      .eq("practice_id", practice.id).order("sort_order", { ascending: true }),
    db.from("services").select("name, category, price_pence, duration_minutes, description")
      .eq("practice_id", practice.id).order("name", { ascending: true }),
  ]);

  const { template, systemPrompt, firstMessage } = await buildAgentConfigForPractice(
    db, practice, practitioners || [], services || [],
  );
  const tools = buildToolDefinitions(FUNCTIONS_URL);

  const agentPayload = {
    name: `${template.agent_persona_name} — ${practice.name}`,
    conversation_config: {
      agent: {
        prompt: {
          prompt: systemPrompt,
          llm: "gpt-4o",
          tools,
          built_in_tools: { end_call: END_CALL_BUILTIN }, // agent can hang up (buffered)
        },
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
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: true, tool_ids: true, tools: true },
            first_message: true,
            language: true,
          },
          tts: { voice_id: false },
        },
        custom_llm_extra_body: false,
        enable_conversation_initiation_client_data_from_webhook: false,
      },
    },
  };

  const res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(agentPayload),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs agent creation failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const agentId = data.agent_id;
  if (!agentId) throw new Error("Agent created but no agent_id returned");

  await db.from("practices").update({ elevenlabs_agent_id: agentId }).eq("id", practice.id);

  return {
    agent_id: agentId,
    created: true,
    persona: template.agent_persona_name,
    industry: template.id,
    catalog_seeded: seeded.seeded_services > 0 || seeded.seeded_practitioner,
  };
}
