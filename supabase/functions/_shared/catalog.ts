/**
 * ensureBookableCatalog — guarantees a practice has the minimum data the
 * booking tools need (≥1 service, ≥1 practitioner) so search_availability
 * can return a slot and request_appointment can confirm it.
 *
 * Used by:
 *   - provision-practice (at first agent provisioning)
 *   - backfill-practices (to repair existing practices, incl. demos)
 *
 * Idempotent: only seeds when the relational tables are empty. Seeds the
 * practice's vertical default_services from industry_templates plus one
 * default practitioner (so search_availability's seniority fallback always
 * has someone to book with). Returns what it did, for reporting.
 *
 * Why this exists: for ~6 weeks new practices shipped with empty
 * services/practitioners tables (only updatePractice synced JSONB→tables,
 * createPractice didn't), so agents "picked up but wouldn't book". Seeding
 * here closes the gap on both the create path and the backfill path from
 * one place.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CatalogResult {
  seeded_services: number;
  seeded_practitioner: boolean;
  already_had_services: boolean;
  already_had_practitioners: boolean;
}

// deno-lint-ignore no-explicit-any
export async function ensureBookableCatalog(
  db: SupabaseClient,
  practice: { id: string; name?: string; industry?: string | null },
): Promise<CatalogResult> {
  const result: CatalogResult = {
    seeded_services: 0,
    seeded_practitioner: false,
    already_had_services: false,
    already_had_practitioners: false,
  };

  const [{ count: svcCount }, { count: pracCount }] = await Promise.all([
    db.from("services").select("id", { count: "exact", head: true }).eq("practice_id", practice.id),
    db.from("practitioners").select("id", { count: "exact", head: true }).eq("practice_id", practice.id),
  ]);

  result.already_had_services = (svcCount || 0) > 0;
  result.already_had_practitioners = (pracCount || 0) > 0;

  // Nothing to do if both tables already have rows.
  if (result.already_had_services && result.already_had_practitioners) return result;

  const { data: tpl } = await db
    .from("industry_templates")
    .select("default_services, practitioner_titles, practitioner_role_labels")
    .eq("id", practice.industry || "dental")
    .single();

  if (!result.already_had_services) {
    const defaults = (tpl?.default_services as Array<Record<string, unknown>>) || [];
    if (defaults.length > 0) {
      const { error } = await db.from("services").insert(
        defaults.map((s) => ({
          practice_id: practice.id,
          name: s.name,
          category: s.category || "general",
          price_pence: s.price_pence ?? null,
          duration_minutes: s.duration_minutes ?? 30,
          buffer_minutes: 5,
          description: s.description || "",
        })),
      );
      if (!error) result.seeded_services = defaults.length;
    }
  }

  if (!result.already_had_practitioners) {
    const titles = (tpl?.practitioner_titles as string[]) || ["Dr"];
    const roleLabels = (tpl?.practitioner_role_labels as string[]) || ["Clinician"];
    const { error } = await db.from("practitioners").insert({
      practice_id: practice.id,
      name: `Lead ${roleLabels[0] || "Clinician"}`,
      title: titles[0] || "",
      sort_order: 1,
    });
    if (!error) result.seeded_practitioner = true;
  }

  return result;
}
