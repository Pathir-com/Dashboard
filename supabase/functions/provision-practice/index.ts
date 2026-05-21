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
import { ensureAgentForPractice } from "../_shared/provision.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    /* Single source of truth for agent creation (shared with
       twilio-assign-number and backfill-practices): seeds a bookable
       catalog, builds the current vertical prompt, creates the agent with
       the chosen voice, stores the id. */
    const ensured = await ensureAgentForPractice(db, practice, { force });

    console.log(`[PROVISION] Agent ${ensured.agent_id} ready for ${practice.name}`);

    return new Response(JSON.stringify({
      success: true,
      agent_id: ensured.agent_id,
      agent_name: ensured.persona,
      industry: ensured.industry,
      practice_name: practice.name,
      message: `${ensured.persona} agent provisioned for ${practice.name}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[PROVISION ERROR]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
