/**
 * Purpose:
 *   Scrape a clinic website and return a structured summary that the
 *   onboarding form (and Settings → Clinic Details) uses to auto-fill
 *   practice fields. Mirrors the JSON shape that Base44's clinic
 *   "ClinicFlow AI" extractor used so the same React handler works in
 *   both contexts.
 *
 * Auth:
 *   JWT required. The user must own the practice they're scraping for.
 *
 * Body:
 *   {
 *     practiceId: uuid,         // for ownership check + audit
 *     url: string,              // clinic website URL (with or without scheme)
 *     industry?: 'dental' | 'hair_transplant',  // hint for the LLM (optional)
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     extracted: {
 *       name, phone, email, address, description,
 *       services: [{name, description, price?}],
 *       business_hours: [{day, is_open, open_time, close_time}],
 *       staff: [{name, title, credentials, specialty, bio}],
 *       faqs: [{question, answer}],
 *       insurance_accepted: [string],
 *       appointment_booking_url: string,
 *       agent_tone, clinic_guidelines
 *     },
 *     mode: 'live' | 'stub',    // 'stub' if ANTHROPIC_API_KEY missing
 *     fetched_chars: number,    // length of HTML text we sent to the LLM
 *   }
 *
 * Backend:
 *   - Server-side fetch of the URL (5s timeout, follows redirects)
 *   - Strip HTML tags + scripts/styles, keep visible text
 *   - Send the cleaned text to Claude Haiku 4.5 with a JSON-schema
 *     response_format constraint
 *   - Returns the structured object directly
 *
 * If ANTHROPIC_API_KEY is not set in Supabase secrets the function
 * runs in 'stub' mode and returns an empty-skeleton response so the
 * frontend can still be exercised end-to-end during development.
 *
 * Changes:
 *   2026-05-04: Initial.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_CHARS = 80_000; // cap before sending to LLM

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

    /* During onboarding Step 2 the practice row doesn't exist yet — the
       user has a valid JWT but nothing to own. We let practiceId be null
       in that case and skip the ownership check; the result goes back
       to the caller's local state and the practice row is created in
       Step 3 with the auto-filled values already merged in.
       Once a practice exists, we DO require ownership (Settings tab). */
    let targetIndustry = industry || "dental";
    if (practiceId) {
      const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: practice, error: pErr } = await db
        .from("practices")
        .select("id, name, industry, owner_id")
        .eq("id", practiceId)
        .eq("owner_id", user.id)
        .single();

      if (pErr || !practice) {
        return jsonResp({ error: "Practice not found or not owned by you" }, 404);
      }
      targetIndustry = industry || practice.industry || "dental";
    }

    /* Fetch the page. Generous timeout, follow redirects, plausible UA so
       sites don't 403 us. We don't render JS — for clinic marketing pages
       static HTML is almost always enough. */
    const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const r = await fetch(cleanUrl, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Pathir-Scraper/1.0; +https://pathir.com)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      html = await r.text();
    } catch (e) {
      console.error("[SCRAPE] fetch failed:", (e as Error).message);
      return jsonResp({
        error: `Could not fetch ${cleanUrl}: ${(e as Error).message}`,
      }, 502);
    }

    const text = stripHtml(html).slice(0, MAX_HTML_CHARS);

    if (!ANTHROPIC_API_KEY) {
      console.warn("[SCRAPE] ANTHROPIC_API_KEY not set — returning stub");
      return jsonResp({
        ok: true,
        mode: "stub",
        fetched_chars: text.length,
        extracted: { ...EMPTY, name: deriveNameFromUrl(cleanUrl) },
      });
    }

    const extracted = await extractWithClaude(text, cleanUrl, targetIndustry);

    return jsonResp({
      ok: true,
      mode: "live",
      fetched_chars: text.length,
      extracted,
    });
  } catch (err) {
    console.error("[SCRAPE ERROR]", err);
    return jsonResp({ error: (err as Error).message }, 500);
  }
});

/** Strip script/style/HTML, collapse whitespace. Cheap, predictable. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function deriveNameFromUrl(u: string): string {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "");
    return host.split(".")[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

async function extractWithClaude(
  pageText: string,
  url: string,
  industry: string,
): Promise<ExtractedClinic> {
  const verticalHint = industry === "hair_transplant"
    ? "This is a hair transplant clinic. Surgeons (not dentists), procedures (FUE, DHI, PRP, beard/eyebrow transplants), graft counts. Use 'Client' not 'Patient'."
    : "This is a dental practice. Dentists, hygienists, services (check-up, hygiene, cosmetic, emergency).";

  const systemPrompt = `You extract structured information about a UK healthcare clinic from its website. Return ONLY a single JSON object matching the schema. No prose.

${verticalHint}

Rules:
- If a field is not on the page, return an empty string or empty array — never guess.
- Phone numbers: keep the raw format from the page; do not normalise.
- business_hours: include all 7 days. is_open=false for closed days.
- services: prefer the clinic's own naming. Include description if visible. Include price as text (e.g. "from £85") if visible.
- staff: include credentials (e.g. "GDC 12345", "BDS", "FRCS") if visible.
- agent_tone: a short instruction (one sentence) that captures the clinic's brand voice from the website copy — formal/warm/casual/professional. This goes into our AI agent's system prompt.
- clinic_guidelines: any clinic policies that the AI agent should know (cancellation, late arrivals, payment terms, urgent care policy). Empty string if none on the page.`;

  const userPrompt = `Source URL: ${url}

Page text (truncated):
${pageText}`;

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    /* Use a forced tool-call to constrain the output shape — Anthropic's
       supported way of getting strict JSON without a free-text JSON parse. */
    tools: [{
      name: "save_clinic",
      description: "Save the structured clinic information extracted from the website.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          address: { type: "string" },
          description: { type: "string" },
          services: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                price: { type: "string" },
              },
              required: ["name"],
            },
          },
          business_hours: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "string" },
                is_open: { type: "boolean" },
                open_time: { type: "string" },
                close_time: { type: "string" },
              },
              required: ["day", "is_open"],
            },
          },
          staff: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                title: { type: "string" },
                credentials: { type: "string" },
                specialty: { type: "string" },
                bio: { type: "string" },
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
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as {
    content?: Array<{ type: string; name?: string; input?: ExtractedClinic }>;
  };
  const toolBlock = (data.content || []).find(
    (b) => b.type === "tool_use" && b.name === "save_clinic",
  );
  if (!toolBlock?.input) {
    throw new Error("Anthropic response did not contain save_clinic tool call");
  }

  return { ...EMPTY, ...toolBlock.input };
}

function jsonResp(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
