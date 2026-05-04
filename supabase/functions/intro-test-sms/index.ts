/**
 * Purpose:
 *   Send an introductory SMS during onboarding so a brand-new clinic can
 *   test the two-way SMS flow before connecting their own number. The
 *   message goes from a shared Pathir-owned number; a 24h `sms_trial_routes`
 *   entry tells the inbound webhook which practice to attach the user's
 *   reply to (routing by sender's mobile, not by recipient).
 *
 * Auth:
 *   JWT required — the user must own the practice they're testing for.
 *
 * Body:
 *   { practiceId: uuid, to: string }   // `to` accepts UK or E.164
 *
 * Response:
 *   { ok: true, provider, messageId, expiresAt }
 *
 * Env:
 *   PATHIR_TRIAL_SMS_NUMBER  — shared TextMagic number used during trials.
 *                              Defaults to +447418341716 (the existing
 *                              platform number) if unset, so onboarding
 *                              works without extra config. Override per-env
 *                              if a dedicated trial number is provisioned.
 *
 * Changes:
 *   2026-05-04: Initial.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone } from "../_shared/match-contact.ts";
import { sendSms } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PATHIR_TRIAL_SMS_NUMBER = Deno.env.get("PATHIR_TRIAL_SMS_NUMBER") || "+447418341716";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResp({ error: "Missing authorization" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResp({ error: "Unauthorized" }, 401);

    const { practiceId, to } = await req.json();
    if (!practiceId || !to) {
      return jsonResp({ error: "practiceId and to are required" }, 400);
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: practice, error: pErr } = await db
      .from("practices")
      .select("id, name, industry, owner_id")
      .eq("id", practiceId)
      .eq("owner_id", user.id)
      .single();

    if (pErr || !practice) {
      return jsonResp({ error: "Practice not found or not owned by you" }, 404);
    }

    const { data: template } = await db
      .from("industry_templates")
      .select("agent_persona_name")
      .eq("id", practice.industry || "dental")
      .single();

    const personaName = template?.agent_persona_name || "your AI receptionist";

    const userPhone = normalizePhone(to);
    if (!userPhone || userPhone.replace(/\D/g, "").length < 8) {
      return jsonResp({ error: "Invalid mobile number" }, 400);
    }

    /* Loop guard: never let a clinic test against their own platform-trial
       number. If `to` matches the trial-sender, we'd loop. */
    if (normalizePhone(PATHIR_TRIAL_SMS_NUMBER) === userPhone) {
      return jsonResp({ error: "Mobile number cannot equal the trial sender" }, 400);
    }

    const body =
      `Hi — this is ${personaName} from ${practice.name}, the AI receptionist on Pathir. ` +
      `Reply to this message with anything — a question about services, prices, or to book in. ` +
      `Your reply will appear in your Pathir dashboard.`;

    /* Trial-mode practice shape: route through the platform TextMagic number
       regardless of what (if anything) the practice has configured. We do
       NOT mutate `practices.integrations`, so connecting their own provider
       later still works without conflict. */
    const trialPractice = {
      id: practice.id,
      name: practice.name,
      integrations: {
        sms_provider: "textmagic",
        textmagic: {
          enabled: true,
          phone_number: PATHIR_TRIAL_SMS_NUMBER,
          sender_id: PATHIR_TRIAL_SMS_NUMBER,
        },
      },
    };

    const result = await sendSms(trialPractice, userPhone, body);

    /* Register the routing entry. UNIQUE(user_phone) means a new signup
       overrides any older trial for the same mobile — that's fine, the
       latest practice owns the route until they connect their own number. */
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: routeErr } = await db
      .from("sms_trial_routes")
      .upsert(
        { user_phone: userPhone, practice_id: practice.id, expires_at: expiresAt },
        { onConflict: "user_phone" },
      );

    if (routeErr) {
      console.error("[INTRO TEST SMS] Failed to register trial route:", routeErr);
      // Outbound went out, but inbound replies won't route. Surface this so
      // the dashboard can warn rather than silently fail end-to-end.
      return jsonResp({
        ok: true,
        provider: result.provider,
        messageId: result.messageId,
        warning: "Outbound sent but trial-route registration failed; inbound replies may not route correctly.",
      });
    }

    console.log(`[INTRO TEST SMS] ${practice.name} -> ${userPhone} via ${result.provider} (${result.messageId})`);

    return jsonResp({
      ok: true,
      provider: result.provider,
      messageId: result.messageId,
      from: result.from,
      to: result.to,
      expiresAt,
    });
  } catch (err) {
    console.error("[INTRO TEST SMS ERROR]", err);
    return jsonResp({ error: (err as Error).message }, 500);
  }
});

function jsonResp(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
