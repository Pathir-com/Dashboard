/**
 * backfill-practices — bring EVERY existing practice (incl. the Spark /
 * Berkeley demos) up to the current fixes. Idempotent; safe to re-run.
 *
 * For each practice it:
 *   1. ensureBookableCatalog — seeds default services + a practitioner if
 *      the relational tables are empty (fixes "picks up but won't book"
 *      for practices created before createPractice synced the catalog).
 *   2. Rebuilds the voice system prompt from the current industry_templates
 *      (migration 024: caller-ID aware, never hang up, no repeats) and
 *      PATCHes the EXISTING ElevenLabs agent — same agent_id, so the
 *      phone-number→agent registration stays valid (do NOT force-create).
 *   3. Re-points the practice's Twilio number voice_url at ElevenLabs
 *      (fixes the dead-VAPI routing from the 2026-03-27 mis-revert).
 *
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY (or a service_role JWT). Walks the
 * practices table — not a hardcoded list — so all verticals are covered.
 *
 * Why this exists: a fix that only helps NEW signups leaves the visible
 * demos broken. Fixes must repair existing data too.
 *
 * Changes:
 *   2026-05-04: Initial.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAgentConfigForPractice } from "../_shared/industry.ts";
import { buildToolDefinitions } from "../_shared/agent-config.ts";
import { ensureBookableCatalog } from "../_shared/catalog.ts";
import { ensureAgentForPractice } from "../_shared/provision.ts";
import { ensurePhoneRegisteredToAgent } from "../_shared/phone-registration.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const ELEVENLABS_VOICE_URL = "https://api.elevenlabs.io/twilio/inbound_call";
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

async function patchAgentPrompt(agentId: string, body: Record<string, unknown>) {
  return fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  // Service-role only (gateway has verify_jwt=true; we additionally require
  // the service_role claim or the raw service-role key).
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  let role = "";
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      role = String(JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role || "");
    }
  } catch { /* not a JWT */ }
  if (role !== "service_role" && token !== SERVICE_ROLE) {
    return new Response("forbidden", { status: 403 });
  }

  // Optional: limit to one practice via ?practice_id= for targeted re-runs.
  const url = new URL(req.url);
  const onlyPracticeId = url.searchParams.get("practice_id");

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  let q = db
    .from("practices")
    .select("id, name, industry, locations, opening_hours, elevenlabs_agent_id, twilio_phone_number, owner_id");
  if (onlyPracticeId) q = q.eq("id", onlyPracticeId);
  const { data: practices, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const twilioAuth = TWILIO_SID && TWILIO_TOKEN ? btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`) : "";
  const report: Record<string, unknown>[] = [];

  for (const p of practices || []) {
    const entry: Record<string, unknown> = { practice: p.name, id: p.id, industry: p.industry };
    try {
      // 1. Catalog
      entry.catalog = await ensureBookableCatalog(db, p);

      /* 1b. Missing agent — provision one. Older practices that finished
         onboarding in the fire-and-forget era (e.g. Baker Street) have
         elevenlabs_agent_id = "" and never got an agent. Create one so the
         practice can actually take calls/chats. */
      if ((!p.elevenlabs_agent_id || p.elevenlabs_agent_id === "") && ELEVENLABS_API_KEY) {
        try {
          const ensured = await ensureAgentForPractice(db, p);
          p.elevenlabs_agent_id = ensured.agent_id; // so steps below use it
          entry.agent_provisioned = { agent_id: ensured.agent_id, created: ensured.created };
        } catch (e) {
          entry.agent_provision_error = (e as Error).message;
        }
      }

      // 2. Voice prompt — PATCH the existing agent (keep agent_id).
      if (p.elevenlabs_agent_id && ELEVENLABS_API_KEY) {
        const [{ data: practitioners }, { data: services }] = await Promise.all([
          db.from("practitioners").select("name, title, credentials, services, bio")
            .eq("practice_id", p.id).order("sort_order", { ascending: true }),
          db.from("services").select("name, category, price_pence, duration_minutes, description")
            .eq("practice_id", p.id).order("name", { ascending: true }),
        ]);
        const { systemPrompt, firstMessage } = await buildAgentConfigForPractice(
          db, p, practitioners || [], services || [],
        );
        /* First try: PATCH prompt TEXT + first_message only. Healthy agents
           keep their existing tool documents untouched (migration 024 only
           changes wording). */
        let r = await patchAgentPrompt(p.elevenlabs_agent_id, {
          conversation_config: {
            agent: { prompt: { prompt: systemPrompt }, first_message: firstMessage },
          },
        });

        /* Self-heal: some agents have dangling tool_ids (tool documents that
           were deleted), so ANY PATCH 404s on document_not_found — that's
           Spark. Retry clearing the broken tool_ids and installing fresh
           inline tool definitions, which repairs the agent's tooling and
           updates the prompt in one go. */
        if (!r.ok) {
          const errText = await r.text();
          if (/document_not_found|not_found/i.test(errText)) {
            const tools = buildToolDefinitions(FUNCTIONS_URL);
            r = await patchAgentPrompt(p.elevenlabs_agent_id, {
              conversation_config: {
                agent: {
                  prompt: { prompt: systemPrompt, llm: "gpt-4o", tool_ids: [], tools },
                  first_message: firstMessage,
                  language: "en",
                },
              },
            });
            entry.agent_repaired_tools = r.ok;
          }
          if (!r.ok) entry.agent_patch_error = (await r.text()).slice(0, 200);
        }
        entry.agent_patch = { agent_id: p.elevenlabs_agent_id, status: r.status, ok: r.ok };
      } else {
        entry.agent_patch = "skipped (no agent or no EL key)";
      }

      // 3. Twilio routing → ElevenLabs.
      if (p.twilio_phone_number && twilioAuth) {
        const lookup = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(p.twilio_phone_number)}`,
          { headers: { Authorization: `Basic ${twilioAuth}` } },
        );
        const lj = await lookup.json();
        const num = (lj.incoming_phone_numbers || [])[0];
        if (num?.sid) {
          if (num.voice_url === ELEVENLABS_VOICE_URL) {
            entry.twilio = { number: p.twilio_phone_number, voice_url: "already ElevenLabs" };
          } else {
            const upd = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers/${num.sid}.json`,
              {
                method: "POST",
                headers: { Authorization: `Basic ${twilioAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ VoiceUrl: ELEVENLABS_VOICE_URL, VoiceMethod: "POST" }).toString(),
              },
            );
            entry.twilio = { number: p.twilio_phone_number, was: num.voice_url, now: ELEVENLABS_VOICE_URL, status: upd.status };
          }
        } else {
          entry.twilio = { number: p.twilio_phone_number, note: "not found on Twilio account" };
        }
      } else {
        entry.twilio = "skipped (no number or no Twilio creds)";
      }

      /* 4. ElevenLabs phone-number → agent registration. The number may be
         registered to a recycled/old agent (Berkeley's were on "Antrim
         House") or none — converge it to THIS practice's agent so inbound
         calls actually reach the right agent. */
      if (p.twilio_phone_number && p.elevenlabs_agent_id && ELEVENLABS_API_KEY) {
        entry.el_phone_registration = await ensurePhoneRegisteredToAgent({
          elevenLabsApiKey: ELEVENLABS_API_KEY,
          phoneNumber: p.twilio_phone_number,
          agentId: p.elevenlabs_agent_id,
          label: `Pathir - ${(p.name || "").trim()}`,
          twilioSid: TWILIO_SID,
          twilioToken: TWILIO_TOKEN,
        });
      }
    } catch (e) {
      entry.error = (e as Error).message;
    }
    report.push(entry);
  }

  return new Response(JSON.stringify({ count: report.length, report }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
