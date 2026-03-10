/**
 * Purpose:
 *     Create and manage appointment requests (pending bookings).
 *     Handles creating requests from voice/chat, and confirming/declining from dashboard.
 *
 * Dependencies:
 *     - Supabase (appointment_requests, appointments, contacts, services, practitioners)
 *     - api/_lib/practice-hours.js (check if submitted outside hours)
 *
 * Used by:
 *     - api/vapi-server-url.js (request_appointment tool)
 *     - api/chatbase-action.js (chat booking action)
 *     - Dashboard UI (confirm/decline/reschedule)
 *
 * Changes:
 *     2026-03-10: Initial creation
 */

import { createClient } from "@supabase/supabase-js";
import { getPracticeHoursStatus } from "./_lib/practice-hours.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * POST /api/appointment-request
 *
 * Body:
 *   { practice_id, contact_id, service_id, chosen_slot, is_urgent, source, notes,
 *     backup_slot?, suggested_slots?, preferred_practitioner_id? }
 *
 * PATCH /api/appointment-request?id=xxx
 *   { status: "confirmed" | "declined" | "rescheduled", notes? }
 *
 * GET /api/appointment-request?practiceId=xxx
 *   Returns all pending/asap requests for the practice
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (req.method === "POST") {
      return handleCreate(adminClient, req, res);
    }

    if (req.method === "PATCH") {
      return handleUpdate(adminClient, req, res);
    }

    if (req.method === "GET") {
      return handleList(adminClient, req, res);
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (err) {
    console.error("[APPOINTMENT-REQUEST ERROR]", err);
    return res.status(500).json({ message: err.message });
  }
}

/**
 * Create a new appointment request.
 */
async function handleCreate(db, req, res) {
  const {
    practice_id,
    contact_id,
    service_id,
    chosen_slot,
    backup_slot,
    suggested_slots,
    is_urgent = false,
    source = "phone",
    notes,
    preferred_practitioner_id,
    preferred_date,
    preferred_time,
  } = req.body;

  if (!practice_id) {
    return res.status(400).json({ message: "practice_id is required" });
  }

  // Check if practice is currently open
  const { data: practice } = await db
    .from("practices")
    .select("opening_hours, holiday_hours")
    .eq("id", practice_id)
    .single();

  const hoursStatus = practice
    ? getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours)
    : { is_open_now: false };

  const outsideHours = !hoursStatus.is_open_now;

  // Determine status: urgent with no slot → asap
  const status = is_urgent && !chosen_slot ? "asap" : "pending";

  const { data: request, error } = await db
    .from("appointment_requests")
    .insert({
      practice_id,
      contact_id: contact_id || null,
      service_id: service_id || null,
      preferred_practitioner_id: preferred_practitioner_id || null,
      preferred_date: preferred_date || (chosen_slot?.date || null),
      preferred_time: preferred_time || (chosen_slot?.start_time || null),
      is_urgent,
      status,
      suggested_slots: suggested_slots || [],
      chosen_slot: chosen_slot || null,
      backup_slot: backup_slot || null,
      notes: outsideHours
        ? `${notes || ""} [Submitted outside practice hours]`.trim()
        : (notes || null),
      submitted_outside_hours: outsideHours,
      source,
    })
    .select()
    .single();

  if (error) {
    console.error("[APPOINTMENT-REQUEST] Create failed:", error);
    return res.status(500).json({ message: "Failed to create appointment request" });
  }

  console.log(`[APPOINTMENT-REQUEST] Created ${request.id} (${status}) for practice ${practice_id}`);

  return res.json({
    success: true,
    request_id: request.id,
    status,
    submitted_outside_hours: outsideHours,
  });
}

/**
 * Update an appointment request (confirm, decline, reschedule).
 */
async function handleUpdate(db, req, res) {
  const { id } = req.query;
  const { status, notes } = req.body;

  if (!id || !status) {
    return res.status(400).json({ message: "id and status are required" });
  }

  const updates = { status };
  if (notes) updates.notes = notes;
  if (status === "confirmed") updates.confirmed_at = new Date().toISOString();

  const { data: request, error } = await db
    .from("appointment_requests")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[APPOINTMENT-REQUEST] Update failed:", error);
    return res.status(500).json({ message: "Failed to update appointment request" });
  }

  // If confirmed and there's a chosen_slot, create the actual appointment
  if (status === "confirmed" && request.chosen_slot) {
    const slot = request.chosen_slot;

    const { error: apptError } = await db
      .from("appointments")
      .insert({
        practice_id: request.practice_id,
        practitioner_id: slot.practitioner_id,
        service_id: request.service_id,
        contact_id: request.contact_id,
        starts_at: `${slot.date}T${slot.start_time}:00`,
        ends_at: `${slot.date}T${slot.end_time}:00`,
        status: "confirmed",
        source: request.source,
        notes: request.notes,
      });

    if (apptError) {
      console.error("[APPOINTMENT-REQUEST] Failed to create appointment:", apptError);
      // Don't fail the request update — the request was confirmed, appointment creation is secondary
    }

    // TODO: Send confirmation SMS to patient
  }

  return res.json({ success: true, request });
}

/**
 * List appointment requests for a practice.
 * Returns ASAP first, then pending, ordered by creation date.
 */
async function handleList(db, req, res) {
  const { practiceId } = req.query;

  if (!practiceId) {
    return res.status(400).json({ message: "practiceId is required" });
  }

  const { data: requests, error } = await db
    .from("appointment_requests")
    .select(`
      *,
      contacts:contact_id ( name, phone, email ),
      services:service_id ( name ),
      practitioners:preferred_practitioner_id ( name )
    `)
    .eq("practice_id", practiceId)
    .in("status", ["asap", "pending"])
    .order("status", { ascending: true }) // "asap" sorts before "pending"
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[APPOINTMENT-REQUEST] List failed:", error);
    return res.status(500).json({ message: "Failed to list requests" });
  }

  return res.json({ requests: requests || [] });
}
