/**
 * Shared AI reply helper. Uses ElevenLabs Conversational AI over WebSocket
 * to fetch a one-shot reply from the practice's agent — same brain as
 * phone calls. Provides a fallback reply when the WS call fails or times
 * out so webhooks stay responsive.
 *
 * Why WebSocket: ElevenLabs ConvAI has no REST one-shot text endpoint —
 * every candidate path under /v1/convai returns 404. WebSocket is the
 * documented integration path for both text and voice.
 *
 * Used by:
 *   - supabase/functions/meta-webhook/index.ts
 *   - supabase/functions/textmagic-webhook/index.ts
 *
 * Changes:
 *   2026-04-24: Initial WebSocket implementation — previous REST version
 *               hit a non-existent endpoint and always fell through to
 *               the static fallback.
 */

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";

export type Channel =
  | "sms"
  | "facebook"
  | "instagram"
  | "web_chat"
  | "email";

const CHANNEL_LABEL: Record<Channel, string> = {
  sms: "SMS text message",
  facebook: "Facebook Messenger message",
  instagram: "Instagram DM",
  web_chat: "website chat message",
  email: "email",
};

export interface AiReplyOptions {
  agentId: string | null | undefined;
  message: string;
  // deno-lint-ignore no-explicit-any
  practiceContext: Record<string, any>;
  conversationHistory: string | null;
  contactName: string;
  channel: Channel;
  /** Total WebSocket timeout in ms. Default 12s. */
  timeoutMs?: number;
}

/**
 * Get an AI reply from ElevenLabs. Returns a string — either the agent's
 * response or a fallback. Never throws.
 */
export async function getAiReply(opts: AiReplyOptions): Promise<string> {
  const { agentId, message, practiceContext, contactName } = opts;

  if (!ELEVENLABS_API_KEY || !agentId) {
    return fallbackReply(contactName, practiceContext.practice_name);
  }

  try {
    const systemPrompt = buildSystemPrompt(opts);
    const reply = await fetchAgentReply(agentId, message, systemPrompt, opts.timeoutMs ?? 12000);
    if (reply && reply.trim().length > 0) {
      return reply.trim();
    }
  } catch (e) {
    console.warn("[AI REPLY] WS error:", e instanceof Error ? e.message : e);
  }

  return fallbackReply(contactName, practiceContext.practice_name);
}

// ---------------------------------------------------------------------------
// Build the per-call context that tells the agent about this channel + clinic
// ---------------------------------------------------------------------------

function buildSystemPrompt(opts: AiReplyOptions): string {
  const { practiceContext, conversationHistory, contactName, channel } = opts;

  const parts = [
    `You are responding to a ${CHANNEL_LABEL[channel]}.`,
    `Practice: ${practiceContext.practice_name}`,
    practiceContext.practice_phone ? `Phone: ${practiceContext.practice_phone}` : null,
    practiceContext.practice_website ? `Website: ${practiceContext.practice_website}` : null,
    practiceContext.opening_hours ? `Hours:\n${practiceContext.opening_hours}` : null,
    practiceContext.clinic_guidelines ? `Guidelines: ${practiceContext.clinic_guidelines}` : null,
    practiceContext.agent_tone ? `Tone: ${practiceContext.agent_tone}` : null,
    practiceContext.practitioners?.length > 0
      // deno-lint-ignore no-explicit-any
      ? `Team:\n${practiceContext.practitioners.map((p: any) => `- ${p.name}${p.credentials ? ` (${p.credentials})` : ""}${p.bio ? `: ${p.bio}` : ""}`).join("\n")}`
      : null,
    practiceContext.prices?.length > 0
      // deno-lint-ignore no-explicit-any
      ? `Prices:\n${practiceContext.prices.map((p: any) => `- ${p.service}: ${p.price}`).join("\n")}`
      : null,
    conversationHistory ? `Previous interactions:\n${conversationHistory}` : null,
    contactName && contactName !== "Unknown" ? `Patient name: ${contactName}` : null,
    channel === "sms"
      ? "Keep replies under 320 characters (2 SMS segments). Plain text, no markdown."
      : null,
  ].filter(Boolean);

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// ElevenLabs ConvAI WebSocket call
// ---------------------------------------------------------------------------

/**
 * Open a WebSocket to the ConvAI agent, send the user message, collect the
 * agent's text reply, close. Resolves to the reply text or null on timeout.
 */
async function fetchAgentReply(
  agentId: string,
  userMessage: string,
  systemPromptAppend: string,
  timeoutMs: number,
): Promise<string | null> {
  // Signed URL authorises the WS handshake without sending the API key over wss.
  const urlRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { headers: { "xi-api-key": ELEVENLABS_API_KEY } },
  );
  if (!urlRes.ok) {
    console.warn("[AI REPLY] get_signed_url failed:", urlRes.status, await urlRes.text().catch(() => ""));
    return null;
  }
  const { signed_url } = await urlRes.json();

  return await new Promise<string | null>((resolve) => {
    let replyText: string | null = null;
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

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          agent: {
            prompt: { prompt: systemPromptAppend },
            first_message: "",
            language: "en",
          },
        },
      }));
    };

    ws.onmessage = (evt) => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(evt.data); } catch { return; }

      const type = data.type as string;

      if (type === "conversation_initiation_metadata") {
        // Agent is ready — send the patient's message.
        ws.send(JSON.stringify({ type: "user_message", text: userMessage }));
      } else if (type === "agent_response") {
        // deno-lint-ignore no-explicit-any
        const evt = data.agent_response_event as any;
        const text = evt?.agent_response;
        if (typeof text === "string") {
          replyText = text;
          // First agent_response is the full reply — we're done.
          finish(replyText);
        }
      } else if (type === "ping") {
        // Keepalive. Echo back so the server doesn't close us for inactivity.
        // deno-lint-ignore no-explicit-any
        const eventId = (data.ping_event as any)?.event_id;
        if (eventId !== undefined) {
          ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
        }
      }
      // Ignore: audio chunks, user_transcript echoes, internal_tentative_*, etc.
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
