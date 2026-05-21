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

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_CHARS = 70_000; // total budget across all pages we send to LLM
const WS_TIMEOUT_MS = 35_000;  // fail fast — the frontend caps at 45s
const MAX_FOLLOW_PAGES = 4;    // hard cap on linked pages we fetch
const PER_PAGE_TIMEOUT_MS = 6_000;

/* Path-keyword scoring for internal-link discovery. Higher score = more
   likely to contain practitioner / service / FAQ content the LLM can use.
   We rank candidate links by max path keyword match and pick the top
   MAX_FOLLOW_PAGES. */
const LINK_KEYWORDS: Array<{ score: number; pattern: RegExp }> = [
  { score: 10, pattern: /\b(team|staff|surgeons?|doctors?|dentists?|clinicians?|practitioners?|consultants?|specialists?|meet[-_]?(the[-_]?)?(team|staff|us))\b/i },
  { score:  9, pattern: /\b(about|who[-_]?we[-_]?are)\b/i },
  { score:  8, pattern: /\b(services?|treatments?|procedures?|what[-_]?we[-_]?do)\b/i },
  { score:  7, pattern: /\b(prices?|pricing|fees?|costs?|price[-_]?list)\b/i },
  { score:  6, pattern: /\b(faqs?|q[-_]?and[-_]?a|questions?)\b/i },
  { score:  5, pattern: /\b(contact|find[-_]?us|opening[-_]?hours?|hours)\b/i },
  { score:  4, pattern: /\b(insurance|finance|payments?)\b/i },
];

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
    let rootHtml = "";
    let resolvedUrl = cleanUrl;
    try {
      const r = await fetchWithTimeout(cleanUrl, FETCH_TIMEOUT_MS);
      rootHtml = await r.text();
      resolvedUrl = r.url || cleanUrl; // honour redirects when scoring same-host links
    } catch (e) {
      console.error("[SCRAPE] fetch failed:", (e as Error).message);
      return jsonResp({ error: `Could not fetch ${cleanUrl}: ${(e as Error).message}` }, 502);
    }

    /* Crawl: pull text from the root page, then follow the highest-scoring
       same-host links (team / services / about / faq / pricing) to give
       the LLM enough context to find every practitioner and service in
       one round-trip — clinics often spread this across multiple pages.
       Whole crawl runs in parallel under a strict total-char budget. */
    const followLinks = pickInternalLinks(rootHtml, resolvedUrl, MAX_FOLLOW_PAGES);
    const followResults = await Promise.allSettled(
      followLinks.map(({ url: linkUrl }) =>
        fetchWithTimeout(linkUrl, PER_PAGE_TIMEOUT_MS).then((r) => r.text()),
      ),
    );
    const pageTexts: Array<{ url: string; text: string }> = [
      { url: resolvedUrl, text: stripHtml(rootHtml) },
      ...followResults
        .map((r, i) => r.status === "fulfilled"
          ? { url: followLinks[i].url, text: stripHtml(r.value) }
          : null,
        )
        .filter((x): x is { url: string; text: string } => x !== null && x.text.length > 200),
    ];

    /* Pack into a single combined-context buffer. We label each page so
       the LLM knows boundaries; budget enforced before LLM call. */
    let combined = "";
    let charsLeft = MAX_HTML_CHARS;
    const pagesUsed: string[] = [];
    for (const pg of pageTexts) {
      if (charsLeft <= 0) break;
      const header = `\n\n=== PAGE: ${pg.url} ===\n`;
      const slice = pg.text.slice(0, charsLeft - header.length);
      if (slice.length < 200) continue;
      combined += header + slice;
      charsLeft -= header.length + slice.length;
      pagesUsed.push(pg.url);
    }
    const text = combined.trim();
    console.log(`[SCRAPE] ${pagesUsed.length} page(s) fetched, ${text.length} chars total: ${pagesUsed.join(", ")}`);

    /* Backend selection. ElevenLabs first (uses team's existing credits),
       Anthropic second, stub last. Each backend returns the same shape. */
    if (SCRAPER_AGENT_ID && ELEVENLABS_API_KEY) {
      try {
        const extracted = await extractWithElevenLabs(text, cleanUrl, targetIndustry);
        return jsonResp({
          ok: true, mode: "elevenlabs",
          fetched_chars: text.length, pages_used: pagesUsed, extracted,
        });
      } catch (e) {
        console.error("[SCRAPE] ElevenLabs path failed:", (e as Error).message);
        // Fall through to Anthropic if available, else stub
      }
    }

    if (ANTHROPIC_API_KEY) {
      const extracted = await extractWithClaude(text, cleanUrl, targetIndustry);
      return jsonResp({
        ok: true, mode: "anthropic",
        fetched_chars: text.length, pages_used: pagesUsed, extracted,
      });
    }

    console.warn("[SCRAPE] No extractor configured — returning stub");
    return jsonResp({
      ok: true, mode: "stub",
      fetched_chars: text.length, pages_used: pagesUsed,
      extracted: { ...EMPTY, name: deriveNameFromUrl(cleanUrl) },
    });
  } catch (err) {
    console.error("[SCRAPE ERROR]", err);
    return jsonResp({ error: (err as Error).message }, 500);
  }
});

/** Fetch with a per-call abort timeout. Returns the Response (caller reads
 *  body). Throws on timeout or network failure. Always follows redirects
 *  so we end up on the canonical version of the page. */
async function fetchWithTimeout(u: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Pathir-Scraper/1.0; +https://pathir.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** Parse anchor tags out of HTML. We deliberately don't run a real DOM
 *  parser — Deno's built-in is too heavy for this and a regex is fine for
 *  the loose href-extraction we need. False positives are filtered later. */
function extractAnchors(html: string): Array<{ href: string; anchorText: string }> {
  const out: Array<{ href: string; anchorText: string }> = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({
      href: m[1].trim(),
      anchorText: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/** Score and pick the most promising internal links to follow.
 *  Returns at most `limit` links, deduplicated by normalised path,
 *  same-host only, ranked by keyword score on path + anchor text. */
function pickInternalLinks(
  html: string,
  baseUrl: string,
  limit: number,
): Array<{ url: string; score: number }> {
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    return [];
  }

  const seen = new Map<string, { url: string; score: number }>();
  for (const { href, anchorText } of extractAnchors(html)) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") ||
        href.startsWith("tel:") || href.startsWith("javascript:")) continue;

    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(absolute.protocol)) continue;
    if (absolute.hostname.replace(/^www\./, "") !== baseHost) continue;

    /* Drop binary asset paths — PDFs, images, etc. The LLM can't use them
       and they waste budget. */
    if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|webm|zip|docx?|xlsx?)$/i.test(absolute.pathname)) continue;

    const path = absolute.pathname.toLowerCase();
    if (path === "/" || path === "") continue; // skip homepage variants

    let score = 0;
    for (const { score: s, pattern } of LINK_KEYWORDS) {
      if (pattern.test(path) || pattern.test(anchorText)) {
        score = Math.max(score, s);
      }
    }
    if (score === 0) continue; // not interesting enough

    const key = absolute.origin + absolute.pathname; // ignore query/fragment for dedup
    const existing = seen.get(key);
    if (!existing || existing.score < score) {
      seen.set(key, { url: key, score });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

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
