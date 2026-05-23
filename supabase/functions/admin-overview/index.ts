/**
 * admin-overview — one audit of every practice, grouped by speciality
 * (industry), cross-checking the DB (source of truth) against ElevenLabs
 * and Twilio so you can see at a glance whether each clinic is correctly
 * wired and what activity it has had.
 *
 * Per practice it reports:
 *   - agent: id + whether it actually exists in ElevenLabs
 *   - number: assigned number, what agent ElevenLabs has it registered to,
 *     whether that matches the DB, and the Twilio voice_url
 *   - catalog: service + practitioner counts, and whether it's bookable
 *   - integrations: which channels are enabled
 *   - interactions: enquiries / conversations / appointments /
 *     appointment_requests counts + last activity timestamp
 *   - health[]: a list of detected problems (empty = all good)
 *
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY (or a service_role JWT).
 * Read-only — never mutates. Use backfill-practices to repair anything
 * this surfaces.
 *
 * 2026-05-21
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const ELEVENLABS_VOICE_URL = "https://api.elevenlabs.io/twilio/inbound_call";

Deno.serve(async (req) => {
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

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Pull external state once, then map per practice.
  const [elAgents, elNumbers, twNumbers] = await Promise.all([
    listElAgents(),
    listElNumbers(),
    listTwilioNumbers(),
  ]);
  const elAgentIds = new Set(elAgents.map((a) => a.agent_id));
  const elNumByPhone = new Map(elNumbers.map((n) => [n.phone_number, n]));
  const twByPhone = new Map(twNumbers.map((n) => [n.phone_number, n]));

  const { data: practices } = await db
    .from("practices")
    .select("id, name, industry, elevenlabs_agent_id, twilio_phone_number, integrations, onboarding_completed, created_at")
    .order("industry", { ascending: true })
    .order("name", { ascending: true });

  // deno-lint-ignore no-explicit-any
  const groups: Record<string, any[]> = {};

  for (const p of practices || []) {
    const [services, practitioners, enquiries, conversations, appointments, requests, lastConv] =
      await Promise.all([
        count(db, "services", p.id),
        count(db, "practitioners", p.id),
        count(db, "enquiries", p.id),
        count(db, "conversations", p.id),
        count(db, "appointments", p.id),
        count(db, "appointment_requests", p.id),
        db.from("conversations").select("started_at").eq("practice_id", p.id)
          .order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

    const integrations = p.integrations || {};
    const num = p.twilio_phone_number || null;
    const elNum = num ? elNumByPhone.get(num) : null;
    const elRegAgent = elNum ? (elNum.assigned_agent?.agent_id || null) : null;
    const tw = num ? twByPhone.get(num) : null;

    const health: string[] = [];
    if (!p.elevenlabs_agent_id) health.push("no agent provisioned");
    else if (!elAgentIds.has(p.elevenlabs_agent_id)) health.push("agent_id not found in ElevenLabs");
    if (services === 0) health.push("no services (not bookable)");
    if (practitioners === 0) health.push("no practitioners (not bookable)");
    if (num) {
      if (tw && tw.voice_url !== ELEVENLABS_VOICE_URL) health.push(`Twilio voice_url not ElevenLabs (${tw.voice_url || "none"})`);
      if (!elNum) health.push("number not registered in ElevenLabs");
      else if (elRegAgent !== p.elevenlabs_agent_id) health.push(`number registered to wrong agent (${elRegAgent || "none"})`);
    }
    if (p.onboarding_completed === false) health.push("onboarding not completed");

    const entry = {
      name: (p.name || "").trim(),
      id: p.id,
      created: p.created_at,
      agent: {
        id: p.elevenlabs_agent_id || null,
        exists_in_elevenlabs: p.elevenlabs_agent_id ? elAgentIds.has(p.elevenlabs_agent_id) : false,
      },
      number: num ? {
        assigned: num,
        twilio_voice_url: tw?.voice_url || "(not on Twilio account)",
        elevenlabs_registered_agent: elRegAgent,
        registration_matches_db: elRegAgent === p.elevenlabs_agent_id,
      } : null,
      catalog: { services, practitioners, bookable: services > 0 && practitioners > 0 },
      integrations: {
        phone: !!integrations.phone_enabled,
        sms: !!integrations.sms_enabled,
        web_chat: !!integrations.web_chat_enabled,
        facebook: !!integrations.facebook_enabled,
        instagram: !!integrations.instagram_enabled,
        email: !!integrations.email_enabled,
        sms_provider: integrations.sms_provider || null,
      },
      interactions: {
        enquiries, conversations, appointments, appointment_requests: requests,
        last_activity: lastConv.data?.started_at || null,
      },
      health,
      ok: health.length === 0,
    };

    const key = p.industry || "unknown";
    (groups[key] ||= []).push(entry);
  }

  const summary = Object.fromEntries(
    Object.entries(groups).map(([k, v]) => [k, {
      practices: v.length,
      healthy: v.filter((e) => e.ok).length,
      with_issues: v.filter((e) => !e.ok).length,
    }]),
  );

  return new Response(JSON.stringify({ summary, by_speciality: groups }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});

// deno-lint-ignore no-explicit-any
async function count(db: any, table: string, practiceId: string): Promise<number> {
  const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("practice_id", practiceId);
  return count || 0;
}

async function listElAgents(): Promise<Array<{ agent_id: string; name: string }>> {
  if (!ELEVENLABS_API_KEY) return [];
  const out: Array<{ agent_id: string; name: string }> = [];
  let cursor: string | null = null;
  while (true) {
    const url = `https://api.elevenlabs.io/v1/convai/agents?page_size=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await fetch(url, { headers: { "xi-api-key": ELEVENLABS_API_KEY } });
    if (!r.ok) break;
    const d = await r.json();
    for (const a of d.agents || []) out.push({ agent_id: a.agent_id, name: a.name });
    if (!d.has_more || !d.next_cursor) break;
    cursor = d.next_cursor;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function listElNumbers(): Promise<any[]> {
  if (!ELEVENLABS_API_KEY) return [];
  const r = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers", { headers: { "xi-api-key": ELEVENLABS_API_KEY } });
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : (d.phone_numbers || []);
}

// deno-lint-ignore no-explicit-any
async function listTwilioNumbers(): Promise<any[]> {
  if (!TWILIO_SID || !TWILIO_TOKEN) return [];
  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers.json?PageSize=100`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!r.ok) return [];
  const d = await r.json();
  return (d.incoming_phone_numbers || []).map((n: Record<string, unknown>) => ({
    phone_number: n.phone_number, voice_url: n.voice_url, friendly_name: n.friendly_name,
  }));
}
