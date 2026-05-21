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
import { buildToolDefinitions } from "../_shared/agent-config.ts";
import { buildAgentConfigForPractice } from "../_shared/industry.ts";
import { ensureBookableCatalog } from "../_shared/catalog.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const ELEVENLABS_VOICE_URL = "https://api.elevenlabs.io/twilio/inbound_call";
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

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
        const tools = buildToolDefinitions(FUNCTIONS_URL);
        const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${p.elevenlabs_agent_id}`, {
          method: "PATCH",
          headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_config: {
              agent: {
                prompt: { prompt: systemPrompt, llm: "gpt-4o", tools },
                first_message: firstMessage,
                language: "en",
              },
            },
          }),
        });
        entry.agent_patch = { agent_id: p.elevenlabs_agent_id, status: r.status, ok: r.ok };
        if (!r.ok) entry.agent_patch_error = (await r.text()).slice(0, 200);
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
    } catch (e) {
      entry.error = (e as Error).message;
    }
    report.push(entry);
  }

  return new Response(JSON.stringify({ count: report.length, report }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
