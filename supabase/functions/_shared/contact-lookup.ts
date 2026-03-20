/**
 * Contact lookup and conversation history retrieval.
 */

import { normalizePhone } from "./normalize-phone.ts";

// deno-lint-ignore no-explicit-any
type DB = any;
const CONTACT_COLS = "id, name, phone, email, date_of_birth, address, postcode";

/** Find a contact by phone — tries exact, normalised, and +44↔0 variants. */
export async function findContactByPhone(db: DB, practiceId: string, phone: string) {
  const normalised = normalizePhone(phone);

  // Try all variants in parallel instead of sequentially
  const alt = phone.startsWith("+44") ? "0" + phone.slice(3)
    : phone.startsWith("0") ? "+44" + phone.slice(1)
    : null;

  const queries = [
    db.from("contacts").select(CONTACT_COLS).eq("practice_id", practiceId).eq("phone", phone).limit(1).single(),
  ];
  if (normalised !== phone) {
    queries.push(db.from("contacts").select(CONTACT_COLS).eq("practice_id", practiceId).eq("phone", normalised).limit(1).single());
  }
  if (alt) {
    queries.push(db.from("contacts").select(CONTACT_COLS).eq("practice_id", practiceId).eq("phone", alt).limit(1).single());
  }

  const results = await Promise.all(queries);
  for (const r of results) {
    if (r.data) return r.data;
  }
  return null;
}

/**
 * Build a human-readable summary of past conversations for RAG context.
 * Searches by contact_id first, then by phone number.
 */
export async function getConversationHistory(db: DB, opts: { contactId?: string; phone?: string; practiceId: string }) {
  const { contactId, phone, practiceId } = opts;
  const convCols = "channel, status, outcome, summary, caller_name, started_at, duration_seconds";

  let conversations = null;

  if (contactId) {
    const { data } = await db.from("conversations").select(convCols)
      .eq("contact_id", contactId).eq("practice_id", practiceId)
      .order("started_at", { ascending: false }).limit(5);
    conversations = data;
  }

  if ((!conversations || conversations.length === 0) && phone) {
    const normalised = normalizePhone(phone);
    const { data } = await db.from("conversations").select(convCols)
      .eq("caller_phone", normalised).eq("practice_id", practiceId)
      .order("started_at", { ascending: false }).limit(5);
    conversations = data;
  }

  if (!conversations || conversations.length === 0) return null;

  const channelLabel: Record<string, string> = { phone: "Phone call", web_chat: "Web chat", sms: "Text message" };
  const lines = conversations.map((c: { channel: string; outcome: string; summary: string; started_at: string }) => {
    const date = new Date(c.started_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const via = channelLabel[c.channel] || c.channel;
    const outcomeStr = c.outcome ? ` → ${c.outcome.replace(/_/g, " ")}` : "";
    return `- ${date} (${via}): ${c.summary || "No summary"}${outcomeStr}`;
  });

  return "Previous interactions:\n" + lines.join("\n");
}
