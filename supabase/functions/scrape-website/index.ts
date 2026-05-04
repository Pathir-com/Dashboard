/**
 * Purpose:
 *   Scrape a clinic website and return a structured summary that the
 *   onboarding form (and Settings → Clinic Details) uses to auto-fill
 *   practice fields.
 *
 * Backend selection (in order of preference):
 *   1. ElevenLabs ConvAI extractor agent (`SCRAPER_AGENT_ID` env) —
 *      reuses the team's ConvAI minutes; default and recommended.
 *   2. Anthropic Claude (`ANTHROPIC_API_KEY` env) — fallback / for higher
 *      extraction quality if needed.
 *   3. Stub (neither configured) — returns empty schema with the
 *      URL-derived clinic name so the frontend works in development.
 *
 * Auth: JWT required. If practiceId is supplied, the caller must own it
 *       (Settings tab path). Onboarding sends practiceId=null since the
 *       practice row doesn't exist yet.
 *
 * Body:  { practiceId: uuid|null, url: string, industry?: 'dental'|'hair_transplant' }
 * Resp:  { ok, mode: 'elevenlabs'|'anthropic'|'stub', extracted: {...}, fetched_chars }
 *
 * Changes:
 *   2026-05-04: Add ElevenLabs ConvAI backend, make it the default.
 *   2026-05-04: Initial Anthropic-only implementation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const SCRAPER_AGENT_ID = Deno.env.get("SCRAPER_AGENT_ID") || "";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_CHARS = 60_000;
const WS_TIMEOUT_MS = 45_000;

interface ExtractedClinic {
  name: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  services: Array<{ name: string; description?: string; price?: string }>;
  business_hours: Array<{ day: string; is_open: boolean; open_time: string; close_time: string }>;
  staff: Array<{ name: string; title?: string; credentials?: string; specialty?: string; bio?: string }>;
  faqs: Array<{ question: string; answer: string }>;
  insurance_accepted: string[];
  appointment_booking_url: string;
  agent_tone: string;
  clinic_guidelines: string;
}

const EMPTY: ExtractedClinic = {
  name: "", phone: "", email: "", address: "", description: "",
  services: [], business_hours: [], staff: [], faqs: [],
  insurance_accepted: [], appointment_booking_url: "",
  agent_tone: "", clinic_guidelines: "",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResp({ error: "Missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResp({ error: "Unauthorized" }, 401);

    const { practiceId, url, industry } = await req.json();
    if (!url) return jsonResp({ error: "url is required" }, 400);

    let targetIndustry = industry || "dental";
    if (practiceId) {
      const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: practice, error: pErr } = await db
        .from("practices")
        .select("id, industry, owner_id")
        .eq("id", practiceId)
        .eq("owner_id", user.id)
        .single();
      if (pErr || !practice) {
        return jsonResp({ error: "Practice not found or not owned by you" }, 404);
      }
      targetIndustry = industry || practice.industry || "dental";
    }

    const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const r = await fetch(cleanUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Pathir-Scraper/1.0; +https://pathir.com)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      html = await r.text();
    } catch (e) {
      console.error("[SCRAPE] fetch failed:", (e as Error).message);
      return jsonResp({ error: `Could not fetch ${cleanUrl}: ${(e as Error).message}` }, 502);
    }
    const text = stripHtml(html).slice(0, MAX_HTML_CHARS);

    /* Backend selection. ElevenLabs first (uses team's existing credits),
       Anthropic second, stub last. Each backend returns the same shape. */
    if (SCRAPER_AGENT_ID && ELEVENLABS_API_KEY) {
      try {
        const extracted = await extractWithElevenLabs(text, cleanUrl, targetIndustry);
        return jsonResp({ ok: true, mode: "elevenlabs", fetched_chars: text.length, extracted });
      } catch (e) {
        console.error("[SCRAPE] ElevenLabs path failed:", (e as Error).message);
        // Fall through to Anthropic if available, else stub
      }
    }

    if (ANTHROPIC_API_KEY) {
      const extracted = await extractWithClaude(text, cleanUrl, targetIndustry);
      return jsonResp({ ok: true, mode: "anthropic", fetched_chars: text.length, extracted });
    }

    console.warn("[SCRAPE] No extractor configured — returning stub");
    return jsonResp({
      ok: true,
      mode: "stub",
      fetched_chars: text.length,
      extracted: { ...EMPTY, name: deriveNameFromUrl(cleanUrl) },
    });
  } catch (err) {
    console.error("[SCRAPE ERROR]", err);
    return jsonResp({ error: (err as Error).message }, 500);
  }
});

/** Strip script/style/HTML, collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}

function deriveNameFromUrl(u: string): string {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "");
    return host.split(".")[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch { return ""; }
}

/* ─────────────────────────────────────────────────────────────────────────
   ElevenLabs ConvAI WebSocket extraction.

   We open a single conversation, override the agent's first_message to
   empty (skips the auto-greeting → faster), send the page text as a
   user_message, capture the first agent_response, parse JSON. Falls
   back to {} if the response can't be parsed cleanly.
   ──────────────────────────────────────────────────────────────────────── */

async function extractWithElevenLabs(
  pageText: string,
  url: string,
  industry: string,
): Promise<ExtractedClinic> {
  const verticalHint = industry === "hair_transplant"
    ? "Hair transplant clinic — surgeons, FUE/DHI/PRP, graft counts. Use 'Client'."
    : "Dental practice — dentists, hygienists, check-up/cosmetic/emergency.";

  const userMessage =
    `Source URL: ${url}\nVertical hint: ${verticalHint}\n\nPage text:\n${pageText}\n\n` +
    `Return ONLY the JSON object. No prose.`;

  // Get a signed WebSocket URL for our extractor agent.
  const sigRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${SCRAPER_AGENT_ID}`,
    { headers: { "xi-api-key": ELEVENLABS_API_KEY } },
  );
  if (!sigRes.ok) {
    throw new Error(`Signed-URL fetch ${sigRes.status}: ${(await sigRes.text()).slice(0, 200)}`);
  }
  const { signed_url } = await sigRes.json() as { signed_url: string };

  const json = await convaiOneShot(signed_url, userMessage);
  return { ...EMPTY, ...json };
}

/** Open a ConvAI WS, send one user_message, wait for the agent_response,
 *  parse the first JSON object found, close. Returns parsed object or {}. */
function convaiOneShot(signedUrl: string, userMessage: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(signedUrl);
    let agentText = "";
    let resolved = false;

    const finish = (val: Record<string, unknown> | null, err?: Error) => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch { /* */ }
      if (err) return reject(err);
      resolve(val || {});
    };

    const timer = setTimeout(
      () => finish(null, new Error(`ConvAI WS timeout after ${WS_TIMEOUT_MS}ms`)),
      WS_TIMEOUT_MS,
    );

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          agent: { first_message: "" }, // skip greeting
        },
      }));
    };

    ws.onmessage = (evt) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(typeof evt.data === "string" ? evt.data : ""); }
      catch { return; }

      const type = msg.type as string;
      if (type === "conversation_initiation_metadata") {
        ws.send(JSON.stringify({ type: "user_message", text: userMessage }));
        return;
      }
      if (type === "agent_response") {
        const ev = msg.agent_response_event as { agent_response?: string } | undefined;
        agentText = ev?.agent_response || agentText;
        const parsed = extractFirstJsonObject(agentText);
        if (parsed) {
          clearTimeout(timer);
          finish(parsed);
        }
        return;
      }
      if (type === "ping") {
        const ev = msg.ping_event as { event_id?: number } | undefined;
        ws.send(JSON.stringify({ type: "pong", event_id: ev?.event_id }));
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      finish(null, new Error("ConvAI WS error"));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      const parsed = extractFirstJsonObject(agentText);
      finish(parsed || {});
    };
  });
}

/** Find the first balanced JSON object in a string and return it parsed,
 *  or null if no object is present / parse fails. Handles markdown
 *  fences and prose-wrapped responses gracefully. */
function extractFirstJsonObject(s: string): Record<string, unknown> | null {
  if (!s) return null;
  const stripped = s.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  let depth = 0, start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = stripped.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { start = -1; }
      }
    }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
   Anthropic fallback — used when SCRAPER_AGENT_ID isn't set or ElevenLabs
   call fails. Forced tool-call for strict JSON.
   ──────────────────────────────────────────────────────────────────────── */

async function extractWithClaude(
  pageText: string,
  url: string,
  industry: string,
): Promise<ExtractedClinic> {
  const verticalHint = industry === "hair_transplant"
    ? "This is a hair transplant clinic. Surgeons, FUE/DHI/PRP. Use 'Client'."
    : "This is a dental practice. Dentists, hygienists.";

  const systemPrompt = `You extract structured information about a UK healthcare clinic from its website. Return ONLY a single JSON object via the save_clinic tool.

${verticalHint}

Rules:
- Empty string or empty array if a field isn't on the page.
- business_hours: include all 7 days. is_open=false for closed.
- services: prefer the clinic's own naming. Include description and price if visible.
- staff: include credentials (e.g. "GDC 12345", "BDS") if visible.
- agent_tone: one short sentence.
- clinic_guidelines: cancellation/payment/urgent care policies; empty if absent.`;

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: `Source URL: ${url}\n\nPage text:\n${pageText}` }],
    tools: [{
      name: "save_clinic",
      description: "Save the structured clinic information.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" }, phone: { type: "string" }, email: { type: "string" },
          address: { type: "string" }, description: { type: "string" },
          services: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, description: { type: "string" }, price: { type: "string" } },
              required: ["name"],
            },
          },
          business_hours: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "string" }, is_open: { type: "boolean" },
                open_time: { type: "string" }, close_time: { type: "string" },
              },
              required: ["day", "is_open"],
            },
          },
          staff: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" }, title: { type: "string" },
                credentials: { type: "string" }, specialty: { type: "string" }, bio: { type: "string" },
              },
              required: ["name"],
            },
          },
          faqs: {
            type: "array",
            items: {
              type: "object",
              properties: { question: { type: "string" }, answer: { type: "string" } },
              required: ["question", "answer"],
            },
          },
          insurance_accepted: { type: "array", items: { type: "string" } },
          appointment_booking_url: { type: "string" },
          agent_tone: { type: "string" },
          clinic_guidelines: { type: "string" },
        },
        required: [
          "name", "phone", "email", "address", "description",
          "services", "business_hours", "staff", "faqs",
          "insurance_accepted", "appointment_booking_url",
          "agent_tone", "clinic_guidelines",
        ],
      },
    }],
    tool_choice: { type: "tool", name: "save_clinic" },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json() as {
    content?: Array<{ type: string; name?: string; input?: ExtractedClinic }>;
  };
  const toolBlock = (data.content || []).find(
    (b) => b.type === "tool_use" && b.name === "save_clinic",
  );
  if (!toolBlock?.input) throw new Error("Anthropic response missing save_clinic tool call");
  return { ...EMPTY, ...toolBlock.input };
}

function jsonResp(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
