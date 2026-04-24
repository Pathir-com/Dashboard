/**
 * Shared AI reply helper. Calls ElevenLabs Conversational AI (text mode) with
 * the practice's system context so every text-based channel (SMS, FB, IG,
 * web chat) uses the same agent brain as phone calls.
 *
 * Used by:
 *   - supabase/functions/meta-webhook/index.ts
 *   - supabase/functions/textmagic-webhook/index.ts
 *
 * Changes:
 *   2026-04-24: Extracted from meta-webhook so TextMagic reuses the same path.
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
}

/**
 * Get an AI response from ElevenLabs Conversational AI (text mode).
 * Falls back to a static reply if the API is unavailable or unconfigured.
 */
export async function getAiReply(opts: AiReplyOptions): Promise<string> {
  const { agentId, message, practiceContext, conversationHistory, contactName, channel } = opts;

  if (!ELEVENLABS_API_KEY || !agentId) {
    return fallbackReply(contactName, practiceContext.practice_name);
  }

  try {
    const contextParts = [
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
      // SMS has a 160-char segment cost, so ask for brevity on that channel.
      channel === "sms"
        ? "Keep replies under 320 characters (2 SMS segments). Use plain text, no markdown."
        : null,
    ].filter(Boolean);

    const res = await fetch(
      "https://api.elevenlabs.io/v1/convai/conversation/text",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          agent_id: agentId,
          text: message,
          context: {
            overrides: {
              system_prompt_append: contextParts.join("\n\n"),
            },
          },
        }),
      },
    );

    if (res.ok) {
      const data = await res.json();
      const aiReply = data.response || data.text || data.message;
      if (aiReply && typeof aiReply === "string" && aiReply.trim().length > 0) {
        return aiReply.trim();
      }
    } else {
      const errText = await res.text();
      console.warn("[AI REPLY] ElevenLabs error:", res.status, errText);
    }
  } catch (e) {
    console.warn("[AI REPLY] ElevenLabs call failed:", e);
  }

  return fallbackReply(contactName, practiceContext.practice_name);
}

function fallbackReply(contactName: string, practiceName: string): string {
  const greeting = contactName && contactName !== "Unknown"
    ? `Hi ${contactName.split(" ")[0]}! `
    : "Hi! ";
  return `${greeting}Thanks for your message. The team at ${practiceName} will get back to you shortly.`;
}
