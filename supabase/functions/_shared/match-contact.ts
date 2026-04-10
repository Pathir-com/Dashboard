/**
 * Purpose:
 *   Cross-channel contact matching and history retrieval.
 *   Matches patients by phone first, then email, or creates a new contact.
 *
 * Dependencies:
 *   - @supabase/supabase-js (SupabaseClient instance passed in)
 *
 * Used by:
 *   - supabase/functions/chatbase-webhook/index.ts
 *   - supabase/functions/chatbase-action/index.ts
 *   - supabase/functions/vapi-webhook/index.ts
 *   - supabase/functions/twilio-sms-webhook/index.ts
 *   - supabase/functions/meta-webhook/index.ts
 *
 * Changes:
 *   2026-03-09: Ported from api/_lib/match-contact.js to Deno Edge Function
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ContactInput {
  practiceId: string;
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  facebookPsid?: string;
  instagramId?: string;
}

/** Normalize a UK phone number to E.164 format (+44...) */
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, "").trim();
  // UK local: 07xxx → +447xxx
  if (p.startsWith("0") && p.length >= 10) {
    p = "+44" + p.slice(1);
  }
  // Missing +: 447xxx → +447xxx
  if (p.match(/^44\d{9,}$/) && !p.startsWith("+")) {
    p = "+" + p;
  }
  return p;
}

/**
 * Find or create a contact for a practice.
 * Matches by phone number first, then email, then creates new.
 */
export async function findOrCreateContact(
  adminClient: SupabaseClient,
  { practiceId, name, phone: rawPhone, email, source, facebookPsid, instagramId }: ContactInput,
) {
  const phone = rawPhone ? normalizePhone(rawPhone) : undefined;

  // 1. Try matching by Meta sender ID (fastest for Meta channels)
  if (facebookPsid) {
    const { data: byFb } = await adminClient
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("facebook_psid", facebookPsid)
      .limit(1)
      .single();

    if (byFb) {
      const updates: Record<string, string> = {};
      if (name && (!byFb.name || byFb.name === "Unknown")) updates.name = name;
      if (Object.keys(updates).length > 0) {
        await adminClient.from("contacts").update(updates).eq("id", byFb.id);
      }
      return byFb;
    }
  }

  if (instagramId) {
    const { data: byIg } = await adminClient
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("instagram_id", instagramId)
      .limit(1)
      .single();

    if (byIg) {
      const updates: Record<string, string> = {};
      if (name && (!byIg.name || byIg.name === "Unknown")) updates.name = name;
      if (Object.keys(updates).length > 0) {
        await adminClient.from("contacts").update(updates).eq("id", byIg.id);
      }
      return byIg;
    }
  }

  // 2. Try matching by phone
  if (phone) {
    const { data: byPhone } = await adminClient
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("phone", phone)
      .limit(1)
      .single();

    if (byPhone) {
      const updates: Record<string, string> = {};
      if (name && !byPhone.name) updates.name = name;
      if (email && !byPhone.email) updates.email = email;
      // Enrich with Meta IDs if matched by phone
      if (facebookPsid && !byPhone.facebook_psid) updates.facebook_psid = facebookPsid;
      if (instagramId && !byPhone.instagram_id) updates.instagram_id = instagramId;
      if (Object.keys(updates).length > 0) {
        await adminClient.from("contacts").update(updates).eq("id", byPhone.id);
      }
      return byPhone;
    }
  }

  // 3. Try matching by email
  if (email) {
    const { data: byEmail } = await adminClient
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("email", email)
      .limit(1)
      .single();

    if (byEmail) {
      const updates: Record<string, string> = {};
      if (name && !byEmail.name) updates.name = name;
      if (phone && !byEmail.phone) updates.phone = phone;
      // Enrich with Meta IDs if matched by email
      if (facebookPsid && !byEmail.facebook_psid) updates.facebook_psid = facebookPsid;
      if (instagramId && !byEmail.instagram_id) updates.instagram_id = instagramId;
      if (Object.keys(updates).length > 0) {
        await adminClient.from("contacts").update(updates).eq("id", byEmail.id);
      }
      return byEmail;
    }
  }

  // 4. Create new contact
  const { data: newContact, error } = await adminClient
    .from("contacts")
    .insert({
      practice_id: practiceId,
      name: name || "Unknown",
      phone: phone || null,
      email: email || null,
      source: source || "chat",
      ...(facebookPsid ? { facebook_psid: facebookPsid } : {}),
      ...(instagramId ? { instagram_id: instagramId } : {}),
    })
    .select()
    .single();

  if (error) throw error;
  return newContact;
}

/**
 * Match a contact by identity fields (name, DOB, postcode) for web chat.
 * Returns match status and contact if found.
 */
export async function matchContactByIdentity(
  adminClient: SupabaseClient,
  { practiceId, name, dob, postcode, phone }: {
    practiceId: string;
    name: string;
    dob: string;       // ISO date string (YYYY-MM-DD)
    postcode: string;
    phone?: string;
  },
): Promise<{ match: "exact" | "ambiguous" | "none"; contact: any; candidateCount: number }> {
  // Query contacts matching name + DOB + postcode
  const { data: candidates } = await adminClient
    .from("contacts")
    .select("*")
    .eq("practice_id", practiceId)
    .ilike("name", name)
    .eq("date_of_birth", dob)
    .ilike("postcode", postcode);

  const matches = candidates || [];

  if (matches.length === 1) {
    return { match: "exact", contact: matches[0], candidateCount: 1 };
  }

  if (matches.length > 1) {
    // If phone provided, narrow down
    if (phone) {
      const normalized = normalizePhone(phone);
      const phoneMatch = matches.find((c) => c.phone === normalized);
      if (phoneMatch) {
        return { match: "exact", contact: phoneMatch, candidateCount: matches.length };
      }
    }
    return { match: "ambiguous", contact: null, candidateCount: matches.length };
  }

  return { match: "none", contact: null, candidateCount: 0 };
}

/**
 * Retrieve all previous enquiries for a contact, across all channels.
 * Returns them in chronological order with conversation history.
 */
export async function getContactHistory(
  adminClient: SupabaseClient,
  contactId: string,
) {
  const { data: enquiries } = await adminClient
    .from("enquiries")
    .select("id, source, message, conversation, created_at, is_completed")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true });

  return enquiries || [];
}
