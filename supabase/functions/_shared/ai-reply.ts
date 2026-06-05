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
  sms:        "SMS conversation. Reply in 1-2 short sentences, under 280 chars.\n\nBOOKING RULE:\nIf search_availability has returned a slot and the patient accepts/confirms that slot, you MUST call request_appointment in that same turn. Do not only say you will book it.\n\nFor SMS, do NOT call verify_identity just because name or DOB is missing. If the patient provides name and DOB while confirming the slot, pass patient_name and date_of_birth directly to request_appointment.\n\nWhen calling request_appointment, copy the chosen slot fields exactly from the prior search_availability result, and include patient_name/date_of_birth when supplied. For general questions (not booking), answer from the catalog without a tool call.",
  facebook:   "Facebook Messenger. 1–2 short, natural sentences. Under 400 characters. Friendly and human, never stiff.",
  instagram:  "Instagram DM. 1–2 short, natural sentences. Under 400 characters. Friendly and human, never stiff.",
  web_chat:   "Website chat. 1–2 short, natural sentences. The visitor may be evaluating the clinic — be warm and concrete.",
  email:      "Email. Reply in short paragraphs, conversational but professional. No markdown headers. Keep it brief.",
};

export interface AiReplyOptions {
  agentId: string | null | undefined;
  message: string;
  // deno-lint-ignore no-explicit-any
  practiceContext: Record<string, any>;
  conversationHistory: string | null;
  contactName: string;
  /** The contact's phone number, when known. Inbound channels (SMS, Twilio,
   *  Facebook PSID-mapped, etc.) all know who's writing — passing this in
   *  lets the prompt explicitly tell the agent NOT to ask for the phone
   *  number again. Optional so callers without phone context still work. */
  contactPhone?: string | null;
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
        contactPhone: opts.contactPhone || null,
        channel: opts.channel,
        conversationHistory: opts.conversationHistory,
        practiceContext,
      });
    }
  } catch (e) {
    console.warn("[AI REPLY] fresh-prompt build failed, falling back to provisioned prompt:", e);
  }

  /* SMS now keeps its tools — request_appointment has a per-channel
     identity guard (name + DOB required before commit on SMS-source
     enquiries). The WS protocol waits through tool round-trips before
     returning, so the booking actually commits before we close.
     Meta + web chat still strip tools (their identity anchoring is
     weaker and the guard isn't tested for them). */
  const allowTools = opts.channel === "sms";
  /* Tools need a longer ceiling: search_availability + request_appointment
     can take ~6-10s each, and the LLM may emit a chatty interim response
     before/between. 45s is the safe upper bound for a 2-tool turn. */
  const replyTimeoutMs = opts.timeoutMs ?? (allowTools ? 45_000 : 15_000);
  try {
    const reply = await fetchAgentReply(
      agentId,
      message,
      promptOverride,
      replyTimeoutMs,
      allowTools,
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
  contactPhone: string | null;
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
    : "Patient name unknown — ask politely once if booking is needed (never twice).";

  /* Phone is known on every inbound text channel — the lookup happens by
     phone number. Tell the agent explicitly so it stops asking patients
     to re-state their own number, which patients found jarring. */
  const phoneKnownLine = opts.contactPhone
    ? `We already have this patient's phone (${opts.contactPhone}). NEVER ask for their phone, NEVER ask them to confirm it, NEVER repeat it back to them.`
    : "Patient phone is not on file — only ask for it if they want a callback or booking confirmation, and only once.";

  // The override prompt explicitly authorises direct catalog answering
  // for text channels (the provisioned voice prompt instead routes
  // every catalog question through tool calls — wrong shape for SMS).
  return [
    `You are ${persona}, the AI receptionist for ${practice.name}.`,
    `Vertical: ${template.display_name} (${practice.industry}).`,
    `Tone: ${tone}.`,
    "",
    `CHANNEL DIRECTIVES — ${channelInstruction}`,
    "Use the live catalog below to answer questions DIRECTLY. Quote exact prices, durations, practitioner names, and locations from it. Never say 'let me check' or 'I'll look that up' — the data IS this prompt.",
    "Never invent prices, services, or practitioners that aren't listed below. If something isn't here, say so plainly in a sentence and offer to take a message.",
    "",
    "STYLE — Short. Natural. Human. Use everyday language. Contractions are fine. Vary your phrasing — never start two replies the same way. One or two sentences per reply unless they ask a multi-part question. No bullet lists unless they explicitly ask for one. No formal stiff phrases like 'I trust this finds you well' or 'kindly note'.",
    "",
    "ANTI-REPETITION RULES — Read RECENT CONVERSATION HISTORY before replying. (1) Never re-ask anything the patient has already answered. (2) Never re-state information you've already given them this conversation. (3) If they ignore part of a question, ask only the missing piece, not the whole thing again. (4) If you greeted them earlier, do NOT greet them again — go straight to answering.",
    `${phoneKnownLine}`,
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
    "When the patient asks about a service (or which services you offer), ALWAYS state its exact price from SERVICES above in the same reply — don't make them ask twice. When they ask which practitioner does what, name the specific person from PRACTITIONERS above. When they ask about availability or location, reference the OPENING HOURS and LOCATIONS above. Be concrete.",
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
  allowTools: boolean = false,
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
    /* When tools are allowed, the agent may emit a chatty agent_response
       BEFORE calling a webhook tool, then a final agent_response after
       the tool returns. Closing on the first response loses the booking
       commit. Strategy: keep accumulating; close only after `silenceMs`
       of quiet OR the hard `timeoutMs` cap, returning the LATEST text
       (which is the post-tool reply). Tools-off path keeps the old
       single-response close for speed. */
    const silenceMs = allowTools ? 10_000 : 0;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const armSilence = () => {
      if (!silenceMs) return;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => finish(replyText), silenceMs);
    };
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (silenceTimer) clearTimeout(silenceTimer);
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
              /* Tool inclusion is channel-decided: SMS keeps the
                 provisioned tools (lookup_caller_phone, search_availability,
                 request_appointment, end_call, …) so it can fully book.
                 Meta / web chat get an empty list because their identity
                 anchoring is weaker — they answer from the catalog only.
                 request_appointment has its own per-channel verification
                 guard that blocks booking until name + DOB confirmed. */
              ...(allowTools ? {} : { tools: [] }),
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
          ? agentResponsesSeen >= 1
          : agentResponsesSeen >= 2;

        if (!isRealReply) return;
        if (typeof text !== "string" || text.trim().length === 0) return;

        // Always track the latest response. Without tools: finish now (old
        // fast path). With tools: arm/reset the silence timer so we keep
        // waiting through tool round-trips, finishing on the post-tool reply.
        replyText = text;
        if (allowTools) armSilence(); else finish(replyText);
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
