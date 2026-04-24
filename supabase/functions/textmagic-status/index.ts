/**
 * Purpose:
 *   Handles TextMagic delivery status callbacks. Logs the status and updates
 *   sms_status on the matching enquiry so the dashboard can show delivery state.
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *
 * TextMagic setup:
 *   Callback URL (delivery notifications):
 *     https://amxcposgqlmgapzoopze.supabase.co/functions/v1/textmagic-status
 *   Callback format: multipart/form-data
 *
 * Changes:
 *   2026-04-24: Initial — delivery receipts for outbound TextMagic messages.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function parsePayload(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  const out: Record<string, string> = {};

  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }

  try {
    const json = await req.json();
    for (const k of Object.keys(json || {})) out[k] = String(json[k]);
  } catch {
    // ignore
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const form = await parsePayload(req);
    const messageId = form.messageId || form.id || form.reference_id || "";
    const status = form.status || form.state || "unknown";
    const phone = form.phone || form.recipient || form.to || "";

    console.log(
      `[TEXTMAGIC STATUS] id=${messageId} status=${status} phone=${phone} raw=${JSON.stringify(form).slice(0, 300)}`,
    );

    if (messageId) {
      const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await db
        .from("sms_deliveries")
        .upsert(
          {
            provider: "textmagic",
            provider_message_id: String(messageId),
            phone,
            status,
            raw: form,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "provider,provider_message_id" },
        );
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[TEXTMAGIC STATUS ERROR]", err);
    return new Response("OK", { status: 200 });
  }
});
