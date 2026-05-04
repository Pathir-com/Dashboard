/**
 * Supabase test clients + helpers.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";

let adminClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

export async function admin(): Promise<SupabaseClient> {
  if (adminClient) return adminClient;
  const env = await loadEnv();
  adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}

export async function anon(): Promise<SupabaseClient> {
  if (anonClient) return anonClient;
  const env = await loadEnv();
  anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return anonClient;
}

/** Create a fresh anon client signed in as the given user (used for invoking
 *  edge functions that require the user's JWT). */
export async function userClient(email: string, password: string): Promise<SupabaseClient> {
  const env = await loadEnv();
  const c = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Sign-in failed for ${email}: ${error?.message}`);
  }
  return c;
}

/** Direct REST invocation against an edge function — useful when we need to
 *  inspect headers / raw body / non-JSON responses. */
export async function invokeFunction(
  name: string,
  body: Record<string, unknown>,
  jwt?: string,
): Promise<{ status: number; body: any; raw: string }> {
  const env = await loadEnv();
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt || env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: res.status, body: parsed, raw };
}

/** Simulate an inbound TextMagic webhook (multipart/form-data) — used to
 *  test the two-way SMS reply path without sending a real message. */
export async function postTextMagicWebhook(payload: {
  sender: string;
  receiver: string;
  text: string;
  messageId?: string;
}): Promise<{ status: number; body: string }> {
  const env = await loadEnv();
  const form = new FormData();
  form.append("sender", payload.sender);
  form.append("receiver", payload.receiver);
  form.append("text", payload.text);
  form.append("messageId", payload.messageId || `test-${Date.now()}`);

  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/textmagic-webhook`, {
    method: "POST",
    body: form,
  });
  return { status: res.status, body: await res.text() };
}
