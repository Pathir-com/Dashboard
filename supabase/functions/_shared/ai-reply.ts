/**
 * Shared AI reply helper. On every inbound text-channel message (SMS,
 * Facebook, Instagram, web chat, email) it builds a *fresh* system prompt
 * from the database — current industry template + current practitioners +
 * current services + current opening hours + current locations + the
 * patient's name + the recent conversation history — and sends it as a
 * conversation-time override to the practice's ElevenLabs ConvAI agent.
 *
 * Why this shape:
 *   The practice row is the source of truth. If the clinic adds a new
 *   service in Settings → Pricing or hires a new practitioner, the next
 *   inbound reply MUST reflect it. Baking the prompt at agent-creation
 *   time and never refreshing it (the previous behaviour) means the
 *   agent runs on stale data the moment the user touches Settings.
 *
 *   This module re-builds the prompt per inbound, so RAG IS the
 *   database, no re-provisioning required, no per-vertical hardcoding.
 *
 * Performance:
 *   - Skips the agent's auto-greeting via `first_message: ""` override
 *     (saves 1–3s on every reply).
 *   - Sends `user_message` immediately after the override is acknowledged
 *     so the agent generates the real reply on its first response, not
 *     its second.
 *   - 12s WS timeout with a static fallback so webhooks never hang.
 *
 * Channel-aware:
 *   The fresh system prompt explicitly tells the agent to answer
 *   directly from the catalog for text channels (SMS / chat / Meta /
 *   email) and to keep replies short. Voice continues to use the
 *   provisioned tool-driven prompt unchanged (this module is only
 *   called for text).
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildLocationsBlock,
  buildPractitionersBlock,
  buildServicesBlock,
  loadTemplate,
} from "./industry.ts";

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";

export type Channel =
  | "sms"
  | "facebook"
  | "instagram"
  | "web_chat"
  | "email";

const CHANNEL_INSTRUCTION: Record<Channel, string> = {
  sms:        "This is an SMS conversation. Reply concisely (under 320 characters where possible). No markdown. No tool calls.",
  facebook:   "This is a Facebook Messenger conversation. Reply concisely (under 500 characters). Friendly, casual tone.",
  instagram:  "This is an Instagram DM. Reply concisely (under 500 characters). Friendly, casual tone.",
  web_chat:   "This is a website chat conversation. Reply concisely (under 500 characters). The visitor is on the clinic's website and may be evaluating the clinic.",
  email:      "This is an email conversation. Reply in a structured, professional tone. Use short paragraphs, no markdown headers.",
};

export interface AiReplyOptions {
  agentId: string | null | undefined;
  message: string;
  // deno-lint-ignore no-explicit-any
  practiceContext: Record<string, any>;
  conversationHistory: string | null;
  contactName: string;
  channel: Channel;
  /** Total WebSocket timeout in ms. Default 15s. */
  timeoutMs?: number;
  /** Supabase client used to load template + relational catalog. */
  // deno-lint-ignore no-explicit-any
  db?: SupabaseClient;
  /** Practice id — required if `db` is provided so we can refresh from DB. */
  practiceId?: string;
}

/**
 * Get an AI reply. Returns a string — either the agent's response or a
 * channel-appropriate fallback. Never throws.
 */
export async function getAiReply(opts: AiReplyOptions): Promise<string> {
  const { agentId, message, practiceContext, contactName } = opts;

  if (!ELEVENLABS_API_KEY || !agentId) {
    return fallbackReply(contactName, practiceContext.practice_name);
  }

  // Build a fresh, channel-aware system prompt from the database. If we
  // can't refresh (no db or practiceId provided) we fall back to no
  // override and let the agent use its provisioned prompt.
  let promptOverride: string | null = null;
  try {
    if (opts.db && opts.practiceId) {
      promptOverride = await buildFreshPrompt({
        db: opts.db,
        practiceId: opts.practiceId,
        contactName,
        channel: opts.channel,
        conversationHistory: opts.conversationHistory,
        practiceContext,
      });
    }
  } catch (e) {
    console.warn("[AI REPLY] fresh-prompt build failed, falling back to provisioned prompt:", e);
  }

  try {
    const reply = await fetchAgentReply(
      agentId,
      message,
      promptOverride,
      opts.timeoutMs ?? 15000,
    );
    if (reply && reply.trim().length > 0) return reply.trim();
  } catch (e) {
    console.warn("[AI REPLY] WS error:", e instanceof Error ? e.message : e);
  }

  return fallbackReply(contactName, practiceContext.practice_name);
}

// ---------------------------------------------------------------------------
// Fresh-from-DB system prompt builder. System-wide — works for any vertical
// because everything reads from industry_templates + the practice row.
// ---------------------------------------------------------------------------

interface BuildPromptOptions {
  // deno-lint-ignore no-explicit-any
  db: SupabaseClient;
  practiceId: string;
  contactName: string;
  channel: Channel;
  conversationHistory: string | null;
  // deno-lint-ignore no-explicit-any
  practiceContext: Record<string, any>;
}

async function buildFreshPrompt(opts: BuildPromptOptions): Promise<string> {
  const { db, practiceId, channel } = opts;

  // Load practice + relational catalog in parallel.
  const [{ data: practice }, { data: practitioners }, { data: services }] =
    await Promise.all([
      db.from("practices")
        .select("id, name, industry, address, phone, email, website, opening_hours, locations, holiday_hours, usps, practice_plan, clinic_guidelines, agent_tone")
        .eq("id", practiceId)
        .single(),
      db.from("practitioners")
        .select("name, title, credentials, services, bio, working_hours")
        .eq("practice_id", practiceId)
        .order("sort_order", { ascending: true }),
      db.from("services")
        .select("name, category, price_pence, duration_minutes, description")
        .eq("practice_id", practiceId)
        .order("name", { ascending: true }),
    ]);

  if (!practice) throw new Error(`practice ${practiceId} not found`);

  const template = await loadTemplate(db, practice.industry);

  const persona = template.agent_persona_name;
  const tone = practice.agent_tone || "warm, professional, efficient";
  const usps = practice.usps || "";
  const guidelines = practice.clinic_guidelines || "";
  const planLine = practice.practice_plan?.offered
    ? `Practice plan offered: ${practice.practice_plan.terms || "yes"}.`
    : "";

  const hoursBlock = formatHours(practice.opening_hours);
  const practitionersBlock = buildPractitionersBlock(practitioners || []);
  const servicesBlock = buildServicesBlock(services || []);
  const locationsBlock = buildLocationsBlock(practice.locations || []);

  const channelInstruction = CHANNEL_INSTRUCTION[channel] ||
    "Reply concisely from the catalog below.";

  const historyBlock = opts.conversationHistory
    ? `\nRECENT CONVERSATION HISTORY (most recent first):\n${opts.conversationHistory}\n`
    : "";

  const patientLine = opts.contactName && opts.contactName !== "Unknown"
    ? `Patient: ${opts.contactName}.`
    : "Patient name unknown — ask politely if booking is needed.";

  // The override prompt explicitly authorises direct catalog answering
  // for text channels (the provisioned voice prompt instead routes
  // every catalog question through tool calls — wrong shape for SMS).
  return [
    `You are ${persona}, the AI receptionist for ${practice.name}.`,
    `Vertical: ${template.display_name} (${practice.industry}).`,
    `Tone: ${tone}.`,
    "",
    `CHANNEL DIRECTIVES — ${channelInstruction}`,
    "Use the live catalog below to answer questions DIRECTLY. Quote exact prices, durations, practitioner names, and locations from it. Never say 'let me check' or 'I'll look that up' — the data IS this prompt. Only ask for the patient's name + phone when actually booking an appointment.",
    "Never invent prices, services, or practitioners that aren't listed below. If something isn't here, say so and offer to take their details for a callback.",
    "",
    `=== ${practice.name.toUpperCase()} — LIVE DATABASE SNAPSHOT ===`,
    "",
    "OPENING HOURS:",
    hoursBlock,
    "",
    "LOCATIONS:",
    locationsBlock,
    "",
    "PRACTITIONERS:",
    practitionersBlock,
    "",
    "SERVICES & PRICES:",
    servicesBlock,
    "",
    usps ? `WHAT MAKES US DIFFERENT:\n${usps}\n` : "",
    planLine,
    guidelines ? `CLINIC GUIDELINES (always follow):\n${guidelines}\n` : "",
    "",
    `PATIENT CONTEXT — ${patientLine}`,
    historyBlock,
    "",
    "When the patient asks about a service or price, answer with the exact figure from SERVICES above. When they ask which practitioner does what, name the specific person from PRACTITIONERS above. When they ask about availability or location, reference the OPENING HOURS and LOCATIONS above. Be concrete.",
  ].filter(Boolean).join("\n");
}

function formatHours(hours: unknown): string {
  if (!Array.isArray(hours) || hours.length === 0) return "(not set)";
  // deno-lint-ignore no-explicit-any
  return (hours as any[]).map((h) =>
    `- ${h.day}: ${h.is_open ? `${h.open_time}–${h.close_time}` : "Closed"}`
  ).join("\n");
}

// ---------------------------------------------------------------------------
// ElevenLabs ConvAI WebSocket call with prompt override + first_message skip
// ---------------------------------------------------------------------------

async function fetchAgentReply(
  agentId: string,
  userMessage: string,
  promptOverride: string | null,
  timeoutMs: number,
): Promise<string | null> {
  const urlRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { headers: { "xi-api-key": ELEVENLABS_API_KEY } },
  );
  if (!urlRes.ok) {
    console.warn("[AI REPLY] get_signed_url failed:", urlRes.status);
    return null;
  }
  const { signed_url } = await urlRes.json();

  return await new Promise<string | null>((resolve) => {
    let replyText: string | null = null;
    let agentResponsesSeen = 0;
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(value);
    };

    const timer = setTimeout(() => finish(replyText), timeoutMs);
    const ws = new WebSocket(signed_url);

    // If we have a prompt override, the agent skips its auto-greeting
    // (first_message="") so its FIRST agent_response is the real reply.
    // If we don't, the agent emits its provisioned greeting first and
    // we skip it (legacy behaviour).
    const skipGreeting = !!promptOverride;

    ws.onopen = () => {
      // deno-lint-ignore no-explicit-any
      const init: Record<string, any> = {
        type: "conversation_initiation_client_data",
      };
      if (promptOverride) {
        init.conversation_config_override = {
          agent: {
            prompt: {
              prompt: promptOverride,
              // Clear voice-only tools for text channels — the provisioned
              // tools (lookup_caller_phone, search_availability, etc.) tell
              // the LLM to deflect questions to a tool call, which is the
              // wrong behaviour for SMS / chat / Meta. Empty tools list
              // forces the model to answer from the prompt's catalog.
              tools: [],
            },
            first_message: "",
            language: "en",
          },
        };
      }
      ws.send(JSON.stringify(init));
    };

    ws.onmessage = (evt) => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(evt.data); } catch { return; }

      const type = data.type as string;

      if (type === "conversation_initiation_metadata") {
        ws.send(JSON.stringify({ type: "user_message", text: userMessage }));
      } else if (type === "agent_response") {
        agentResponsesSeen++;
        // deno-lint-ignore no-explicit-any
        const text = (data.agent_response_event as any)?.agent_response;

        // Without override: response #1 is the auto-greeting, response #2 is the real reply
        // With override (first_message=""): response #1 IS the real reply
        const isRealReply = skipGreeting
          ? agentResponsesSeen === 1
          : agentResponsesSeen >= 2;

        if (!isRealReply) return;

        if (typeof text === "string" && text.trim().length > 0) {
          replyText = text;
          finish(replyText);
        }
      } else if (type === "ping") {
        // deno-lint-ignore no-explicit-any
        const eventId = (data.ping_event as any)?.event_id;
        if (eventId !== undefined) {
          ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
        }
      }
    };

    ws.onerror = (err) => {
      console.warn("[AI REPLY] WS error event:", (err as Event).type);
      finish(null);
    };

    ws.onclose = () => finish(replyText);
  });
}

// ---------------------------------------------------------------------------

function fallbackReply(contactName: string, practiceName: string): string {
  const greeting = contactName && contactName !== "Unknown"
    ? `Hi ${contactName.split(" ")[0]}! `
    : "Hi! ";
  return `${greeting}Thanks for your message. The team at ${practiceName} will get back to you shortly.`;
}
