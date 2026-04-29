/**
 * One-shot admin: enable conversation-time prompt + first_message overrides
 * on EVERY existing ElevenLabs agent across the practices table, so the
 * cross-channel AI reply path can refresh prompts per inbound. Run this
 * once after deploying the override-aware ai-reply path; future agents
 * are provisioned with overrides on by default (see provision-practice).
 *
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY in the Authorization header.
 *
 * System-wide by design: walks the practices table, not a hardcoded list,
 * so every clinic's agent (dental, hair_transplant, future verticals) is
 * patched in one call.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  // verify_jwt=true on this function means only valid Supabase JWTs reach
  // here. Decode the JWT (no signature verify needed — gateway did it) and
  // require role=service_role.
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  let role = "";
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      role = String(payload.role || "");
    }
  } catch { /* not a JWT */ }
  if (role !== "service_role" && token !== SERVICE_ROLE) {
    return new Response("forbidden", { status: 403 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: practices } = await db
    .from("practices")
    .select("id, name, industry, elevenlabs_agent_id")
    .not("elevenlabs_agent_id", "is", null)
    .neq("elevenlabs_agent_id", "");

  const out: Record<string, unknown>[] = [];
  for (const p of practices || []) {
    const patch = {
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
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${p.elevenlabs_agent_id}`, {
      method: "PATCH",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    out.push({
      practice: p.name,
      industry: p.industry,
      agent_id: p.elevenlabs_agent_id,
      status: r.status,
      ok: r.ok,
      body: await r.text().then((t) => t.slice(0, 200)),
    });
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
