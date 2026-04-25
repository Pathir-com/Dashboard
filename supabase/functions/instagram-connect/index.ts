/**
 * Purpose:
 *   Direct Instagram OAuth (Instagram Login API, not Facebook-Login-with-IG).
 *   Exchanges the short-lived authorization code for a long-lived (60-day)
 *   IGAA access token, subscribes the Instagram Business account to our
 *   meta-webhook, and writes the resulting credentials into the practice's
 *   integrations JSONB.
 *
 *   This sits alongside meta-connect (which handles Facebook Page + linked
 *   IG via FB Login). Use this function when a clinic only has Instagram
 *   (no Facebook Page) or chose the new Instagram Login pathway.
 *
 * Body (POST /functions/v1/instagram-connect):
 *   { practiceId, code, redirectUri }            ← OAuth callback
 *   { practiceId, disconnect: true }             ← teardown
 *
 * Environment secrets:
 *   META_IG_APP_ID       — Pathir-IG app id (1537930541030559)
 *   META_IG_APP_SECRET   — Pathir-IG app secret
 *
 * Deployed with --no-verify-jwt because the dashboard calls this during the
 * OAuth callback redirect, before any user session might be established.
 *
 * Changes:
 *   2026-04-25: Initial — adds self-service Instagram connect to the
 *               Pathir clinic dashboard.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG_APP_ID = Deno.env.get("META_IG_APP_ID") || "";
const IG_APP_SECRET = Deno.env.get("META_IG_APP_SECRET") || "";

const IG_API = "https://graph.instagram.com/v23.0";
const IG_OAUTH = "https://api.instagram.com/oauth/access_token";
const IG_LONG_TOKEN = "https://graph.instagram.com/access_token";

interface PracticeIntegrations {
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { practiceId, code, redirectUri, disconnect } = body;

    if (!practiceId) {
      return jsonError("practiceId required", 400);
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Disconnect ──
    if (disconnect) {
      const { data: prac } = await db
        .from("practices")
        .select("integrations")
        .eq("id", practiceId)
        .single();

      const existing: PracticeIntegrations = { ...(prac?.integrations || {}) };
      const oldToken = existing.instagram_access_token as string | undefined;

      // Best-effort unsubscribe at Meta — ignore errors
      if (oldToken) {
        try {
          await fetch(`${IG_API}/me/subscribed_apps?access_token=${oldToken}`, {
            method: "DELETE",
          });
        } catch { /* ignore */ }
      }

      // Strip every instagram_* key
      for (const key of Object.keys(existing)) {
        if (key.startsWith("instagram_")) delete existing[key];
      }

      await db.from("practices").update({ integrations: existing }).eq("id", practiceId);
      return jsonOk({ disconnected: true });
    }

    // ── Connect ──
    if (!code || !redirectUri) {
      return jsonError("code and redirectUri required", 400);
    }
    if (!IG_APP_ID || !IG_APP_SECRET) {
      return jsonError("Instagram app credentials not configured on the server", 500);
    }

    // 1. Short-lived token (Instagram returns access_token + user_id; ~1h life)
    const shortRes = await fetch(IG_OAUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    const shortData = await shortRes.json();
    if (!shortRes.ok || !shortData.access_token) {
      console.error("[INSTAGRAM CONNECT] short-token exchange failed", shortData);
      return jsonError(
        shortData.error_message || shortData.error?.message || "code exchange failed",
        400,
      );
    }
    const shortToken = shortData.access_token as string;

    // 2. Upgrade to long-lived (60-day) token
    const longUrl = `${IG_LONG_TOKEN}?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(IG_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`;
    const longRes = await fetch(longUrl);
    const longData = await longRes.json();
    if (!longRes.ok || !longData.access_token) {
      console.error("[INSTAGRAM CONNECT] long-token exchange failed", longData);
      return jsonError(
        longData.error?.message || "long token exchange failed",
        400,
      );
    }
    const longToken = longData.access_token as string;
    const expiresIn = longData.expires_in || 5184000; // 60 days default

    // 3. Identify the Instagram account
    const meRes = await fetch(
      `${IG_API}/me?fields=id,username,name,account_type&access_token=${encodeURIComponent(longToken)}`,
    );
    const me = await meRes.json();
    if (!meRes.ok || !me.id) {
      console.error("[INSTAGRAM CONNECT] /me lookup failed", me);
      return jsonError(me.error?.message || "Could not read Instagram account", 400);
    }

    // 4. Subscribe this IG account to our meta-webhook for `messages`
    const subRes = await fetch(
      `${IG_API}/me/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(longToken)}`,
      { method: "POST" },
    );
    const sub = await subRes.json();
    if (!subRes.ok) {
      console.warn("[INSTAGRAM CONNECT] webhook subscription warning", sub);
      // Continue — token is still valid for sending replies; subscription failure
      // can be retried on the next connect.
    }

    // 5. Persist into practice integrations JSONB
    const { data: prac } = await db
      .from("practices")
      .select("integrations")
      .eq("id", practiceId)
      .single();
    const merged: PracticeIntegrations = {
      ...(prac?.integrations || {}),
      instagram_business_id: me.id,
      instagram_username: me.username,
      instagram_account_name: me.name || me.username,
      instagram_account_type: me.account_type,
      instagram_access_token: longToken,
      instagram_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      instagram_enabled: true,
      instagram_connected_at: new Date().toISOString(),
      instagram_connected_via: "instagram_oauth",
    };
    await db.from("practices").update({ integrations: merged }).eq("id", practiceId);

    return jsonOk({
      connected: true,
      instagram: {
        username: me.username,
        accountId: me.id,
        accountName: me.name || me.username,
        accountType: me.account_type,
        subscribed: sub.success === true,
      },
    });
  } catch (err) {
    console.error("[INSTAGRAM CONNECT ERROR]", err);
    return jsonError((err as Error).message || "Internal error", 500);
  }
});

function jsonOk(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
