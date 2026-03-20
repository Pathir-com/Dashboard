/**
 * Practice loader with in-memory cache (30s TTL).
 * Resolves practice by: practiceId → twilioNumber → agentId → single-practice fallback.
 * Builds the base response object shared by lookup_caller_phone and lookup_web_visitor.
 */

import { getPracticeHoursStatus } from "./practice-hours.ts";
import { getUKDateTime } from "./clock.ts";

export const PRACTICE_COLS = "id, name, email, phone, website, opening_hours, holiday_hours, integrations, practitioners, price_list, usps, practice_plan, clinic_guidelines, agent_tone, twilio_phone_number, messaging_service_sid, twilio_sms_number, elevenlabs_agent_id";

// deno-lint-ignore no-explicit-any
type DB = any;

interface CacheEntry {
  // deno-lint-ignore no-explicit-any
  data: any;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000; // 30s — covers a full phone call's tool calls

export async function loadPractice(
  db: DB,
  opts: { practiceId?: string; twilioNumber?: string; agentId?: string },
) {
  // Check cache first
  if (opts.practiceId) {
    const cached = cache.get(opts.practiceId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
  }

  // Resolution chain
  // deno-lint-ignore no-explicit-any
  let practice: any = null;

  if (opts.practiceId) {
    const { data } = await db.from("practices").select(PRACTICE_COLS).eq("id", opts.practiceId).single();
    practice = data;
  }
  if (!practice && opts.twilioNumber) {
    const { data } = await db.from("practices").select(PRACTICE_COLS).eq("twilio_phone_number", opts.twilioNumber).single();
    practice = data;
  }
  if (!practice && opts.agentId) {
    const { data } = await db.from("practices").select(PRACTICE_COLS).eq("elevenlabs_agent_id", opts.agentId).single();
    practice = data;
  }
  if (!practice) {
    const { data } = await db.from("practices").select(PRACTICE_COLS).limit(1).single();
    practice = data;
  }

  if (practice) {
    cache.set(practice.id, { data: practice, expiresAt: Date.now() + TTL_MS });
  }
  return practice;
}

/**
 * Build the "base" response object that both lookup_caller_phone and lookup_web_visitor return.
 * Contains everything the agent needs about the practice — prices, team, hours, guidelines.
 */
// deno-lint-ignore no-explicit-any
export function buildPracticeBase(practice: any) {
  const integrations = practice.integrations || {};
  const clock = getUKDateTime();
  return {
    success: true,
    practice_id: practice.id,
    practice_name: practice.name,
    practice_email: practice.email || integrations.email_from || null,
    practice_phone: practice.phone,
    practice_website: practice.website,
    practice_hours: getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours),
    practice_usps: practice.usps || null,
    practice_plan: practice.practice_plan?.offered ? practice.practice_plan.terms : null,
    clinic_guidelines: practice.clinic_guidelines || null,
    agent_tone: practice.agent_tone || null,
    practitioners: (practice.practitioners || []).map((p: { title?: string; name: string; credentials?: string; bio?: string; services?: string[] }) => ({
      name: `${p.title || ""} ${p.name}`.trim(),
      credentials: p.credentials || null,
      bio: (p.bio || "").slice(0, 150) + ((p.bio || "").length > 150 ? "..." : ""),
      services: p.services || [],
    })),
    prices: (practice.price_list || []).map((p: { service_name: string; price: number; notes?: string }) => ({
      service: p.service_name,
      price: `£${p.price}`,
    })),
    email_enabled: !!integrations.email_enabled,
    stripe_connected: !!integrations.stripe_connected,
    current_datetime: clock,
    agent_instructions: "You are the full point of contact. Never suggest the patient speaks to a team member, calls back, or tries again later. Always aim to resolve their query and book them into an appointment. If a service isn't offered, suggest the closest alternative and offer to book a consultation.",
  };
}
