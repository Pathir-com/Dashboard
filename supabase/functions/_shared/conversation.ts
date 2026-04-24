/**
 * Shared conversation storage helpers. Writes to the normalised
 * enquiry_messages table (one row per message) — no JSONB append, no
 * read-modify-write, no silent message loss when two writes race.
 *
 * Each message is identified by (enquiry_id, provider_message_id). Providing
 * a provider_message_id makes retries idempotent at the DB layer so gateways
 * re-delivering the same webhook cannot duplicate rows.
 *
 * Used by:
 *   - supabase/functions/meta-webhook/index.ts
 *   - supabase/functions/textmagic-webhook/index.ts
 *   - supabase/functions/twilio-sms-webhook/index.ts
 *   - supabase/functions/chatbase-save/index.ts
 *
 * Changes:
 *   2026-04-24: Rewrite onto enquiry_messages table. Previous JSONB append
 *               lost messages under concurrent writes.
 *   2026-04-10: Initial extraction from meta-webhook.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MessageRole = "patient" | "clinic" | "system";

export interface AppendOpts {
  practiceId: string;
  contactId: string;
  patientName: string;
  channel: string;
  message: string;
  role: MessageRole;
  /** Provider's own message id — makes retries idempotent. Optional. */
  providerMessageId?: string | null;
  /** How far back to look for an open enquiry before starting a new one. */
  windowHours?: number;
}

/**
 * Find an existing open enquiry within the window or create a new one, then
 * append a single message row. Returns the enquiry id and whether it was
 * created by this call.
 */
export async function appendToEnquiry(
  db: SupabaseClient,
  opts: AppendOpts,
): Promise<{ enquiryId: string; isNew: boolean }> {
  const windowMs = (opts.windowHours ?? 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs).toISOString();

  const { data: recent } = await db
    .from("enquiries")
    .select("id")
    .eq("contact_id", opts.contactId)
    .eq("is_completed", false)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let enquiryId: string;
  let isNew: boolean;

  if (recent) {
    enquiryId = recent.id;
    isNew = false;
  } else {
    const { data: created, error } = await db
      .from("enquiries")
      .insert({
        practice_id: opts.practiceId,
        contact_id: opts.contactId,
        patient_name: opts.patientName,
        phone_number: null,
        message: opts.message,
        source: opts.channel,
        is_urgent: false,
        is_completed: false,
      })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("Failed to create enquiry");
    enquiryId = created.id;
    isNew = true;
  }

  await insertMessage(db, {
    enquiryId,
    role: opts.role,
    message: opts.message,
    channel: opts.channel,
    providerMessageId: opts.providerMessageId ?? null,
  });

  return { enquiryId, isNew };
}

/** Append a reply (AI or staff) to an existing enquiry. */
export async function appendReplyToEnquiry(
  db: SupabaseClient,
  enquiryId: string,
  message: string,
  channel: string,
  providerMessageId: string | null = null,
): Promise<void> {
  await insertMessage(db, {
    enquiryId,
    role: "clinic",
    message,
    channel,
    providerMessageId,
  });
}

/**
 * Append any pre-formed message to an enquiry (used by transcript ingesters
 * like elevenlabs-conversation that produce many rows at once).
 */
export async function insertMessages(
  db: SupabaseClient,
  rows: Array<{
    enquiryId: string;
    role: MessageRole;
    message: string;
    channel: string;
    providerMessageId?: string | null;
    createdAt?: string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    enquiry_id: r.enquiryId,
    role: r.role,
    message: r.message,
    channel: r.channel,
    provider_message_id: r.providerMessageId ?? null,
    ...(r.createdAt ? { created_at: r.createdAt } : {}),
  }));
  // Upsert on the partial unique index so re-delivery is safe.
  await db
    .from("enquiry_messages")
    .upsert(payload, { onConflict: "enquiry_id,provider_message_id", ignoreDuplicates: true });
}

async function insertMessage(
  db: SupabaseClient,
  row: {
    enquiryId: string;
    role: MessageRole;
    message: string;
    channel: string;
    providerMessageId: string | null;
  },
): Promise<void> {
  if (row.providerMessageId) {
    await db
      .from("enquiry_messages")
      .upsert({
        enquiry_id: row.enquiryId,
        role: row.role,
        message: row.message,
        channel: row.channel,
        provider_message_id: row.providerMessageId,
      }, { onConflict: "enquiry_id,provider_message_id", ignoreDuplicates: true });
  } else {
    await db.from("enquiry_messages").insert({
      enquiry_id: row.enquiryId,
      role: row.role,
      message: row.message,
      channel: row.channel,
    });
  }
}
