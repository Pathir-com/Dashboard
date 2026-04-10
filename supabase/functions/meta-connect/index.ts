/**
 * Meta OAuth token exchange + webhook subscription.
 *
 * Called by the frontend after Meta OAuth redirect:
 *   POST /functions/v1/meta-connect
 *   Body: { practiceId, code, redirectUri }
 *
 * Also supports disconnect:
 *   POST /functions/v1/meta-connect
 *   Body: { practiceId, disconnect: true }
 *
 * Flow:
 *   1. Exchange short-lived code for user access token
 *   2. Exchange user token for long-lived token (~60 days)
 *   3. List user's Pages, pick the first (or specified pageId)
 *   4. Get a Page Access Token (long-lived, never-expiring for Pages)
 *   5. Fetch linked Instagram Business Account if available
 *   6. Subscribe the Page to our meta-webhook
 *   7. Write everything into practice.integrations JSONB
 *
 * Environment secrets:
 *   META_APP_ID        — from Meta App Dashboard
 *   META_APP_SECRET    — from Meta App Dashboard
 *
 * Deployed with --no-verify-jwt (called from frontend during OAuth redirect).
 *
 * Changes:
 *   2026-04-10: Initial creation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID") || "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "pathir_meta_verify_2026";

const GRAPH_API = "https://graph.facebook.com/v19.0";
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/meta-webhook`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { practiceId, code, redirectUri, disconnect, pageId: preferredPageId } = body;

    if (!practiceId) {
      return new Response(JSON.stringify({ error: "practiceId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Disconnect flow ──
    if (disconnect) {
      const { data: practice } = await db
        .from("practices")
        .select("integrations")
        .eq("id", practiceId)
        .single();

      if (!practice) {
        return new Response(JSON.stringify({ error: "Practice not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const integrations = { ...(practice.integrations || {}) };
      // Remove all Meta fields
      delete integrations.facebook_page_id;
      delete integrations.facebook_access_token;
      delete integrations.facebook_page_name;
      delete integrations.facebook_enabled;
      delete integrations.instagram_business_id;
      delete integrations.instagram_access_token;
      delete integrations.instagram_username;
      delete integrations.instagram_enabled;
      delete integrations.meta_user_token;

      await db.from("practices").update({ integrations }).eq("id", practiceId);

      return new Response(JSON.stringify({ success: true, disconnected: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Connect flow: OAuth token exchange ──
    if (!code || !redirectUri) {
      return new Response(JSON.stringify({ error: "code and redirectUri are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!META_APP_ID || !META_APP_SECRET) {
      return new Response(JSON.stringify({ error: "Meta App credentials not configured on server" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Exchange code for short-lived user access token
    const tokenUrl = `${GRAPH_API}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${META_APP_SECRET}&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("[META CONNECT] Token exchange failed:", err);
      return new Response(JSON.stringify({ error: "Failed to exchange code for token", details: err }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { access_token: shortToken } = await tokenRes.json();

    // Step 2: Exchange for long-lived user token (~60 days)
    const longTokenUrl = `${GRAPH_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(shortToken)}`;
    const longTokenRes = await fetch(longTokenUrl);
    let userToken = shortToken;
    if (longTokenRes.ok) {
      const longData = await longTokenRes.json();
      userToken = longData.access_token || shortToken;
    }

    // Step 3: List user's Pages
    const pagesRes = await fetch(`${GRAPH_API}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`);
    if (!pagesRes.ok) {
      const err = await pagesRes.text();
      console.error("[META CONNECT] Failed to list pages:", err);
      return new Response(JSON.stringify({ error: "Failed to list Facebook Pages", details: err }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    if (pages.length === 0) {
      return new Response(JSON.stringify({ error: "No Facebook Pages found on this account. Make sure your account manages at least one Page." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick the preferred page or default to first
    // deno-lint-ignore no-explicit-any
    const page = preferredPageId ? pages.find((p: any) => p.id === preferredPageId) || pages[0] : pages[0];
    const pageAccessToken = page.access_token; // Page tokens from /me/accounts are already long-lived
    const pageId = page.id;
    const pageName = page.name;

    // Step 4: Check for linked Instagram Business Account
    let instagramBusinessId: string | null = null;
    let instagramUsername: string | null = null;
    let instagramAccessToken: string | null = null;

    try {
      const igRes = await fetch(`${GRAPH_API}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(pageAccessToken)}`);
      if (igRes.ok) {
        const igData = await igRes.json();
        if (igData.instagram_business_account?.id) {
          instagramBusinessId = igData.instagram_business_account.id;
          instagramAccessToken = pageAccessToken; // Same token works for IG

          // Get IG username
          const igProfileRes = await fetch(`${GRAPH_API}/${instagramBusinessId}?fields=username&access_token=${encodeURIComponent(pageAccessToken)}`);
          if (igProfileRes.ok) {
            const igProfile = await igProfileRes.json();
            instagramUsername = igProfile.username || null;
          }
        }
      }
    } catch (e) {
      console.warn("[META CONNECT] Instagram lookup failed (non-fatal):", e);
    }

    // Step 5: Subscribe the Page to our webhook
    try {
      const subscribeRes = await fetch(
        `${GRAPH_API}/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${encodeURIComponent(pageAccessToken)}`,
        { method: "POST" },
      );
      if (!subscribeRes.ok) {
        const err = await subscribeRes.text();
        console.warn("[META CONNECT] Webhook subscription failed (non-fatal):", err);
      } else {
        console.log(`[META CONNECT] Page ${pageId} subscribed to webhook`);
      }
    } catch (e) {
      console.warn("[META CONNECT] Webhook subscription error (non-fatal):", e);
    }

    // Step 6: Write to practice integrations
    const { data: practice } = await db
      .from("practices")
      .select("integrations")
      .eq("id", practiceId)
      .single();

    if (!practice) {
      return new Response(JSON.stringify({ error: "Practice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const integrations = {
      ...(practice.integrations || {}),
      facebook_page_id: pageId,
      facebook_access_token: pageAccessToken,
      facebook_page_name: pageName,
      facebook_enabled: true,
      meta_user_token: userToken, // Keep for token refresh
      ...(instagramBusinessId
        ? {
            instagram_business_id: instagramBusinessId,
            instagram_access_token: instagramAccessToken,
            instagram_username: instagramUsername,
            instagram_enabled: true,
          }
        : {}),
    };

    await db.from("practices").update({ integrations }).eq("id", practiceId);

    // Build response
    const result: Record<string, unknown> = {
      success: true,
      facebook: { pageId, pageName, connected: true },
    };

    if (instagramBusinessId) {
      result.instagram = {
        businessId: instagramBusinessId,
        username: instagramUsername,
        connected: true,
      };
    }

    // If user has multiple pages, include the list so frontend can let them pick
    if (pages.length > 1) {
      // deno-lint-ignore no-explicit-any
      result.availablePages = pages.map((p: any) => ({ id: p.id, name: p.name }));
      result.selectedPageId = pageId;
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[META CONNECT ERROR]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
