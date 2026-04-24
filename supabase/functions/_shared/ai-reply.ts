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
    const reply = await fetchAgentReply(agentId, message, opts.timeoutMs ?? 12000);
    if (reply && reply.trim().length > 0) {
      return reply.trim();
    }
  } catch (e) {
    console.warn("[AI REPLY] WS error:", e instanceof Error ? e.message : e);
  }

  return fallbackReply(contactName, practiceContext.practice_name);
}

// ---------------------------------------------------------------------------
// ElevenLabs ConvAI WebSocket call
// ---------------------------------------------------------------------------

/**
 * Open a WebSocket to the ConvAI agent, send the user message, collect the
 * agent's text reply, close. Resolves to the reply text or null on timeout.
 *
 * Protocol notes (probed 2026-04-24):
 *   - Agent config blocks `prompt` and `first_message` overrides, so we
 *     send an empty client-init and rely on the agent's provisioned prompt.
 *     Per-practice context is baked in at agent-creation time by
 *     provision-practice.
 *   - The agent auto-emits its greeting as the FIRST agent_response even
 *     when we send a user_message immediately after the init metadata.
 *     We skip that first response and take the second one as the real
 *     reply to the patient. A quick `interruption` event between them is
 *     normal — the agent cuts its own greeting short to answer the user.
 */
async function fetchAgentReply(
  agentId: string,
  userMessage: string,
  timeoutMs: number,
): Promise<string | null> {
  // Signed URL authorises the WS handshake without leaking the API key on wss.
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

    ws.onopen = () => {
      // Empty client-init: no overrides, use the agent's own configuration.
      ws.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
    };

    ws.onmessage = (evt) => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(evt.data); } catch { return; }

      const type = data.type as string;

      if (type === "conversation_initiation_metadata") {
        // Post the patient's message immediately — the agent will still
        // emit its greeting first, which we'll skip below.
        ws.send(JSON.stringify({ type: "user_message", text: userMessage }));
      } else if (type === "agent_response") {
        agentResponsesSeen++;
        // deno-lint-ignore no-explicit-any
        const text = (data.agent_response_event as any)?.agent_response;

        if (agentResponsesSeen === 1) {
          // This is the auto-greeting ("Hello... welcome to <practice>...").
          // Ignore it; the next agent_response is the real reply.
          return;
        }
        if (typeof text === "string") {
          replyText = text;
          finish(replyText);
        }
      } else if (type === "ping") {
        // Keepalive — echo back so the server doesn't close us mid-generation.
        // deno-lint-ignore no-explicit-any
        const eventId = (data.ping_event as any)?.event_id;
        if (eventId !== undefined) {
          ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
        }
      }
      // Ignore: audio chunks, user_transcript echoes, agent_response_correction,
      // interruption events — none affect the text reply we're after.
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
