/**
 * Purpose:
 *     REST endpoint for searching available appointment slots.
 *     Called by the dashboard, VAPI, and Chatbase.
 *
 * Dependencies:
 *     - api/_lib/availability-search.js (search engine)
 *     - api/_lib/practice-hours.js (hours status)
 *     - Supabase (practices, practitioners, services, appointments)
 *
 * Used by:
 *     - Dashboard UI (diary view, booking modal)
 *     - api/vapi-server-url.js (proxied via tool handler)
 *     - api/chatbase-action.js (proxied via action handler)
 *
 * Changes:
 *     2026-03-10: Initial creation
 */

import { createClient } from "@supabase/supabase-js";
import { searchAvailability } from "./_lib/availability-search.js";
import { getPracticeHoursStatus } from "./_lib/practice-hours.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * GET /api/availability?practiceId=xxx&service=checkup&day=thursday&time=morning&urgent=false
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const {
      practiceId,
      service,
      day,
      time,
      date,
      urgent,
    } = req.query;

    if (!practiceId || !service) {
      return res.status(400).json({ message: "practiceId and service are required" });
    }

    // Fetch practice for hours data
    const { data: practice } = await adminClient
      .from("practices")
      .select("id, opening_hours, holiday_hours")
      .eq("id", practiceId)
      .single();

    if (!practice) {
      return res.status(404).json({ message: "Practice not found" });
    }

    // Include current hours status
    const hoursStatus = getPracticeHoursStatus(
      practice.opening_hours,
      practice.holiday_hours
    );

    const result = await searchAvailability(adminClient, {
      practice_id: practiceId,
      service_name: service,
      preference_day: day || null,
      preference_time: time || null,
      preference_date: date || null,
      is_urgent: urgent === "true",
      opening_hours: practice.opening_hours || [],
      holiday_hours: practice.holiday_hours || [],
    });

    return res.json({
      ...result,
      practice_hours: hoursStatus,
    });
  } catch (err) {
    console.error("[AVAILABILITY ERROR]", err);
    return res.status(500).json({ message: err.message });
  }
}
