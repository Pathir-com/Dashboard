/**
 * Shared conversation storage helpers.
 * Handles finding/creating enquiries and appending messages to the
 * conversation JSONB array. Used by all inbound channels.
 *
 * Used by:
 *   - supabase/functions/meta-webhook/index.ts (Facebook/Instagram)
 *   - supabase/functions/chatbase-save/index.ts (web chat)
 *   - supabase/functions/twilio-sms-webhook/index.ts (SMS)
 *
 * Changes:
 *   2026-04-10: Extracted from meta-webhook into shared module.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ConversationMessage {
  role: "patient" | "clinic";
  message: string;
  timestamp: string;
  channel: string;
}

/**
 * Find a recent open enquiry for a contact (within the given window),
 * or create a new one. Then append the message to the conversation JSONB.
 *
 * Returns the enquiry ID and whether it was newly created.
 */
export async function appendToEnquiry(
  db: SupabaseClient,
  opts: {
    practiceId: string;
    contactId: string;
    patientName: string;
    channel: string;
    message: string;
    role: "patient" | "clinic";
    windowHours?: number; // default 24
  },
): Promise<{ enquiryId: string; isNew: boolean }> {
  const windowMs = (opts.windowHours ?? 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs).toISOString();

  // Look for a recent open enquiry from this contact
  const { data: recentEnquiry } = await db
    .from("enquiries")
    .select("id, conversation")
    .eq("contact_id", opts.contactId)
    .eq("is_completed", false)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const newMessage: ConversationMessage = {
    role: opts.role,
    message: opts.message,
    timestamp: new Date().toISOString(),
    channel: opts.channel,
  };

  if (recentEnquiry) {
    // Append to existing conversation
    const updatedConversation = [
      ...(recentEnquiry.conversation || []),
      newMessage,
    ];
    await db
      .from("enquiries")
      .update({ conversation: updatedConversation })
      .eq("id", recentEnquiry.id);

    return { enquiryId: recentEnquiry.id, isNew: false };
  }

  // Create new enquiry
  const { data: newEnquiry } = await db
    .from("enquiries")
    .insert({
      practice_id: opts.practiceId,
      contact_id: opts.contactId,
      patient_name: opts.patientName,
      message: opts.message,
      source: opts.channel,
      is_urgent: false,
      is_completed: false,
      conversation: [newMessage],
    })
    .select("id")
    .single();

  return { enquiryId: newEnquiry?.id, isNew: true };
}

/**
 * Append a reply (from AI or staff) to an existing enquiry's conversation.
 */
export async function appendReplyToEnquiry(
  db: SupabaseClient,
  enquiryId: string,
  message: string,
  channel: string,
): Promise<void> {
  const { data: enquiry } = await db
    .from("enquiries")
    .select("conversation")
    .eq("id", enquiryId)
    .single();

  if (!enquiry) return;

  const updatedConversation = [
    ...(enquiry.conversation || []),
    {
      role: "clinic" as const,
      message,
      timestamp: new Date().toISOString(),
      channel,
    },
  ];

  await db
    .from("enquiries")
    .update({ conversation: updatedConversation })
    .eq("id", enquiryId);
}
