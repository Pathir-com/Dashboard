/**
 * Purpose:
 *   Email tracking endpoint. Handles two event types:
 *   1. Open tracking — 1x1 transparent pixel loaded by email client
 *   2. Click tracking — redirect link that logs the click then forwards
 *
 *   Updates the email_events table so the dashboard can show:
 *   - When an email was opened (and how many times)
 *   - When a link was clicked (and which URL)
 *
 * Dependencies:
 *   - @supabase/supabase-js
 *   - email_events table (008_email_tracking.sql)
 *
 * Used by:
 *   - Tracking pixel in sent emails (GET ?t=TRACKING_ID&e=open)
 *   - Wrapped links in sent emails (GET ?t=TRACKING_ID&e=click&u=ENCODED_URL)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 1x1 transparent GIF
const PIXEL = Uint8Array.from(atob(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
), c => c.charCodeAt(0));

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const trackingId = url.searchParams.get("t");
  const event = url.searchParams.get("e"); // "open" or "click"
  const redirectUrl = url.searchParams.get("u"); // only for click events

  if (!trackingId || !event) {
    return new Response("", { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (event === "open") {
      // Update opened_at (first open) and increment counter
      const { data: existing } = await db
        .from("email_events")
        .select("id, opened_at, opened_count, status")
        .eq("tracking_id", trackingId)
        .single();

      if (existing) {
        const updates: Record<string, unknown> = {
          opened_count: (existing.opened_count || 0) + 1,
        };
        // Only set opened_at on first open
        if (!existing.opened_at) {
          updates.opened_at = new Date().toISOString();
          updates.status = "opened";
        }
        await db.from("email_events").update(updates).eq("id", existing.id);
      }

      // Return 1x1 transparent pixel
      return new Response(PIXEL, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      });
    }

    if (event === "click" && redirectUrl) {
      const decodedUrl = decodeURIComponent(redirectUrl);

      const { data: existing } = await db
        .from("email_events")
        .select("id, clicked_at, clicked_count, click_urls, status")
        .eq("tracking_id", trackingId)
        .single();

      if (existing) {
        const clickUrls = Array.isArray(existing.click_urls) ? existing.click_urls : [];
        clickUrls.push({ url: decodedUrl, at: new Date().toISOString() });

        const updates: Record<string, unknown> = {
          clicked_count: (existing.clicked_count || 0) + 1,
          click_urls: clickUrls,
        };
        if (!existing.clicked_at) {
          updates.clicked_at = new Date().toISOString();
          updates.status = "clicked";
        }
        await db.from("email_events").update(updates).eq("id", existing.id);
      }

      // Redirect to the actual URL
      return new Response(null, {
        status: 302,
        headers: { "Location": decodedUrl },
      });
    }
  } catch (err) {
    console.error("[TRACK-EMAIL]", err);
  }

  // Fallback: return pixel for open, 404 for unknown
  if (event === "open") {
    return new Response(PIXEL, {
      headers: { "Content-Type": "image/gif" },
    });
  }
  return new Response("", { status: 404 });
});
