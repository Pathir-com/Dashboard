/**
 * Twilio REST helper for tests. Reads from the Mint Dental account.
 */

import { loadEnv } from "./env.ts";

async function twFetch(path: string, init?: RequestInit & { form?: Record<string, string> }): Promise<Response> {
  const env = await loadEnv();
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    ...(init?.headers as Record<string, string> || {}),
  };
  let body: BodyInit | undefined;
  if (init?.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  } else if (init?.body) {
    body = init.body;
  }
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}${path}`, {
    method: init?.method || "GET",
    headers,
    body,
  });
}

export interface TwilioNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  voice_url?: string;
  sms_url?: string;
}

export async function listIncomingNumbers(): Promise<TwilioNumber[]> {
  const res = await twFetch(`/IncomingPhoneNumbers.json?PageSize=200`);
  if (!res.ok) throw new Error(`listIncomingNumbers: ${res.status}`);
  const data = await res.json() as { incoming_phone_numbers: any[] };
  return data.incoming_phone_numbers.map((n: any) => ({
    sid: n.sid,
    phone_number: n.phone_number,
    friendly_name: n.friendly_name,
    capabilities: n.capabilities,
    voice_url: n.voice_url,
    sms_url: n.sms_url,
  }));
}

export async function getBalance(): Promise<{ balance: string; currency: string }> {
  const res = await twFetch(`/Balance.json`);
  if (!res.ok) throw new Error(`getBalance: ${res.status}`);
  return res.json();
}

export async function getNumber(sid: string): Promise<TwilioNumber | null> {
  const res = await twFetch(`/IncomingPhoneNumbers/${sid}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getNumber ${sid}: ${res.status}`);
  const n = await res.json() as any;
  return {
    sid: n.sid,
    phone_number: n.phone_number,
    friendly_name: n.friendly_name,
    capabilities: n.capabilities,
    voice_url: n.voice_url,
    sms_url: n.sms_url,
  };
}

/** Find an unassigned UK SMS-capable number, or pick one whose friendly_name
 *  is empty / starts with the raw E.164 — those are the ones not tied to a
 *  live practice. Returns null if none free. */
export async function findFreeUkSmsNumber(): Promise<TwilioNumber | null> {
  const all = await listIncomingNumbers();
  const candidates = all.filter((n) =>
    n.phone_number.startsWith("+44") &&
    n.capabilities.sms &&
    !/Spark|Berkeley|Pathir/i.test(n.friendly_name),
  );
  return candidates[0] || null;
}
