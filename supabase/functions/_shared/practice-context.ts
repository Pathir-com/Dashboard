/**
 * Shared practice context loader.
 * Loads a practice's full context (practitioners, prices, guidelines, tone,
 * services, hours) from Supabase and formats it for any AI channel.
 *
 * Used by:
 *   - supabase/functions/meta-webhook/index.ts (Facebook/Instagram AI)
 *   - supabase/functions/chatbase-action/index.ts (web chat)
 *   - supabase/functions/elevenlabs-tool/index.ts (phone — uses its own cache wrapper)
 *
 * Changes:
 *   2026-04-10: Extracted from elevenlabs-tool + chatbase-action into shared module.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUKDateTime } from "./clock.ts";

/** Columns needed for context loading. Reusable across all channel loaders. */
export const PRACTICE_CONTEXT_COLS =
  "id, name, email, phone, website, address, practice_type, opening_hours, holiday_hours, integrations, practitioners, price_list, usps, practice_plan, clinic_guidelines, agent_tone, twilio_phone_number, messaging_service_sid, twilio_sms_number, elevenlabs_agent_id";

/**
 * Load a practice row by ID, Twilio number, agent ID, or Meta Page/IG ID.
 * Returns the raw practice row or null.
 */
export async function loadPractice(
  db: SupabaseClient,
  opts: {
    practiceId?: string;
    twilioNumber?: string;
    textmagicNumber?: string;
    agentId?: string;
    facebookPageId?: string;
    instagramBusinessId?: string;
  },
  // deno-lint-ignore no-explicit-any
): Promise<any | null> {
  // deno-lint-ignore no-explicit-any
  let practice: any = null;

  if (opts.practiceId) {
    const { data } = await db
      .from("practices")
      .select(PRACTICE_CONTEXT_COLS)
      .eq("id", opts.practiceId)
      .single();
    practice = data;
  }

  if (!practice && opts.twilioNumber) {
    const { data } = await db
      .from("practices")
      .select(PRACTICE_CONTEXT_COLS)
      .eq("twilio_phone_number", opts.twilioNumber)
      .single();
    practice = data;
  }

  if (!practice && opts.textmagicNumber) {
    const { data: practices } = await db
      .from("practices")
      .select(PRACTICE_CONTEXT_COLS)
      .filter("integrations->textmagic->>phone_number", "eq", opts.textmagicNumber);
    practice = practices?.[0] || null;
  }

  if (!practice && opts.agentId) {
    const { data } = await db
      .from("practices")
      .select(PRACTICE_CONTEXT_COLS)
      .eq("elevenlabs_agent_id", opts.agentId)
      .single();
    practice = data;
  }

  if (!practice && opts.facebookPageId) {
    const { data: practices } = await db
      .from("practices")
      .select(PRACTICE_CONTEXT_COLS)
      .filter("integrations->facebook_page_id", "eq", opts.facebookPageId);
    practice = practices?.[0] || null;
  }

  if (!practice && opts.instagramBusinessId) {
    const { data: practices } = await db
      .from("practices")
      .select(PRACTICE_CONTEXT_COLS)
      .filter("integrations->instagram_business_id", "eq", opts.instagramBusinessId);
    practice = practices?.[0] || null;
  }

  return practice;
}

/**
 * Format a practice row into the context blob that AI agents consume.
 * Shape matches what elevenlabs-tool and chatbase-action both produce.
 */
// deno-lint-ignore no-explicit-any
export function buildPracticeContext(practice: any): Record<string, any> {
  const integrations = practice.integrations || {};
  const ukTime = getUKDateTime();

  return {
    practice_id: practice.id,
    practice_name: practice.name,
    practice_email: practice.email || integrations.email_from || null,
    practice_phone: practice.phone,
    practice_website: practice.website,
    practice_address: practice.address || null,
    practice_type: practice.practice_type || null,

    opening_hours: (practice.opening_hours || [])
      // deno-lint-ignore no-explicit-any
      .map((h: any) => `${h.day}: ${h.is_open ? `${h.open_time}–${h.close_time}` : "Closed"}`)
      .join("\n"),

    clinic_guidelines: practice.clinic_guidelines || null,
    agent_tone: practice.agent_tone || null,

    practitioners: (practice.practitioners || []).map(
      // deno-lint-ignore no-explicit-any
      (p: any) => ({
        name: `${p.title || ""} ${p.name}`.trim(),
        credentials: p.credentials || null,
        bio: (p.bio || "").slice(0, 150) + ((p.bio || "").length > 150 ? "..." : ""),
        services: p.services || [],
      }),
    ),

    prices: (practice.price_list || []).map(
      // deno-lint-ignore no-explicit-any
      (p: any) => ({
        service: p.service_name,
        price: p.is_from_price ? `from £${p.price}` : `£${p.price}`,
        notes: p.notes || null,
      }),
    ),

    about: practice.usps || null,
    practice_plan: practice.practice_plan?.offered
      ? practice.practice_plan.terms
      : null,

    current_datetime: ukTime,
  };
}

/**
 * Get conversation history for a contact across all channels.
 * Returns a formatted string for the AI agent's context, or null.
 */
export async function getConversationHistory(
  db: SupabaseClient,
  contactId: string,
  practiceId: string,
): Promise<string | null> {
  const { data: conversations } = await db
    .from("conversations")
    .select("channel, outcome, summary, started_at")
    .eq("contact_id", contactId)
    .eq("practice_id", practiceId)
    .order("started_at", { ascending: false })
    .limit(5);

  if (!conversations || conversations.length === 0) return null;

  const channelLabel: Record<string, string> = {
    phone: "Phone call",
    web_chat: "Web chat",
    sms: "Text",
    facebook: "Facebook Messenger",
    instagram: "Instagram DM",
    email: "Email",
  };

  const lines = conversations.map((c) => {
    const date = new Date(c.started_at).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const via = channelLabel[c.channel] || c.channel;
    return `- ${date} (${via}): ${c.summary || "No summary"}`;
  });

  return lines.join("\n");
}
