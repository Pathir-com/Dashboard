/**
 * Purpose:
 *   Vertical-aware template loading. Reads the industry_templates row that
 *   matches a practice's `industry` column and interpolates the agent
 *   system prompt + first_message with the practice's actual data
 *   (name, practitioners, services, locations, opening hours).
 *
 *   This is the single point where Pathir branches behaviour by vertical.
 *   No edge function or frontend should hardcode dental-specific or
 *   hair-transplant-specific strings — everything is database-driven.
 *
 * Dependencies:
 *   - @supabase/supabase-js (SupabaseClient passed in)
 *   - migration 022_industry_templates.sql
 *
 * Used by:
 *   - supabase/functions/provision-practice/index.ts
 *   - supabase/functions/elevenlabs-tool/index.ts (for service catalog)
 *   - any future caller that needs vertical-specific behaviour
 *
 * Changes:
 *   2026-04-25: Initial — multi-vertical foundation.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface IndustryTemplate {
  id: string;
  display_name: string;
  agent_persona_name: string;
  agent_system_prompt: string;
  agent_first_message_template: string;
  service_categories: string[];
  practitioner_titles: string[];
  practitioner_role_labels: string[];
  // deno-lint-ignore no-explicit-any
  default_services: any[];
  copy: Record<string, string>;
  disclaimers: string[];
}

/**
 * Look up the industry template for a practice. Falls back to 'dental' if
 * the practice's industry is unrecognised, so an unknown vertical never
 * leaves a clinic without an agent prompt.
 */
export async function loadTemplate(
  db: SupabaseClient,
  industry: string | null | undefined,
): Promise<IndustryTemplate> {
  const wanted = (industry || "dental").toLowerCase();

  const { data: row } = await db
    .from("industry_templates")
    .select("*")
    .eq("id", wanted)
    .single();

  if (row) return row as IndustryTemplate;

  // Fallback: dental row exists in every Pathir deployment (seeded by
  // migration 022). Returning null would break agent provisioning.
  const { data: fallback } = await db
    .from("industry_templates")
    .select("*")
    .eq("id", "dental")
    .single();

  if (!fallback) {
    throw new Error(`No industry template found for '${wanted}' or fallback 'dental'`);
  }
  return fallback as IndustryTemplate;
}

/**
 * Build the practitioners block that gets interpolated into the agent
 * system prompt. Each line names one practitioner, their title, and
 * the services they offer so the agent can route enquiries correctly.
 */
// deno-lint-ignore no-explicit-any
export function buildPractitionersBlock(practitioners: any[] | null | undefined): string {
  if (!practitioners || practitioners.length === 0) {
    return "(no practitioners configured yet)";
  }
  return practitioners.map((p) => {
    const title = p.title ? `${p.title} ` : "";
    const credentials = p.credentials ? ` (${p.credentials})` : "";
    const services = Array.isArray(p.services) && p.services.length
      ? ` — handles: ${p.services.join(", ")}`
      : "";
    const bio = p.bio ? `\n  Bio: ${p.bio}` : "";
    return `- ${title}${p.name}${credentials}${services}${bio}`;
  }).join("\n");
}

/**
 * Build the services block. Reads name, category, price (pence -> pounds),
 * duration, and the patient-facing description that landed in services.description
 * via migration 022.
 */
// deno-lint-ignore no-explicit-any
export function buildServicesBlock(services: any[] | null | undefined): string {
  if (!services || services.length === 0) {
    return "(no services configured yet)";
  }
  return services.map((s) => {
    const price = typeof s.price_pence === "number"
      ? `£${(s.price_pence / 100).toFixed(0)}`
      : (s.price ? `£${s.price}` : "(price on consultation)");
    const dur = s.duration_minutes ? ` ${s.duration_minutes} min` : "";
    const desc = s.description ? ` — ${s.description}` : "";
    return `- ${s.name} (${s.category || "general"}, ${price},${dur})${desc}`;
  }).join("\n");
}

/**
 * Build the locations block. For multi-site clinics (e.g. hair transplant
 * chains) so the agent can ask which site the client wants for booking.
 */
// deno-lint-ignore no-explicit-any
export function buildLocationsBlock(locations: any[] | null | undefined): string {
  if (!locations || locations.length === 0) {
    return "(single location)";
  }
  return locations.map((loc) => {
    const phone = loc.phone ? ` — ${loc.phone}` : "";
    const hours = loc.opening_hours ? `\n  Hours: ${loc.opening_hours}` : "";
    return `- ${loc.name}${loc.address ? `, ${loc.address}` : ""}${phone}${hours}`;
  }).join("\n");
}

export interface InterpolationContext {
  practice_name: string;
  agent_persona_name: string;
  practitioners_block: string;
  services_block: string;
  locations_block: string;
  opening_hours: string;
}

/**
 * Replace every `{key}` placeholder in the prompt template with values
 * from the context. Unknown placeholders are left as-is so they're easy
 * to spot in logs.
 */
export function interpolate(template: string, ctx: Partial<InterpolationContext>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = (ctx as Record<string, unknown>)[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/**
 * One-shot helper: load the template, interpolate it for this practice,
 * return the final system prompt + first_message ready to send to
 * ElevenLabs.
 */
export async function buildAgentConfigForPractice(
  db: SupabaseClient,
  // deno-lint-ignore no-explicit-any
  practice: any,
  // deno-lint-ignore no-explicit-any
  practitioners: any[] = [],
  // deno-lint-ignore no-explicit-any
  services: any[] = [],
): Promise<{
  template: IndustryTemplate;
  systemPrompt: string;
  firstMessage: string;
}> {
  const template = await loadTemplate(db, practice.industry);

  const ctx: InterpolationContext = {
    practice_name: practice.name || "the clinic",
    agent_persona_name: template.agent_persona_name,
    practitioners_block: buildPractitionersBlock(practitioners),
    services_block: buildServicesBlock(services),
    locations_block: buildLocationsBlock(practice.locations),
    opening_hours: practice.opening_hours || "(opening hours not set)",
  };

  return {
    template,
    systemPrompt: interpolate(template.agent_system_prompt, ctx),
    firstMessage: interpolate(template.agent_first_message_template, ctx),
  };
}
