/**
 * Purpose:
 *     Add bio column to practitioners table so the AI agent can reference
 *     practitioner bios during patient conversations.
 *
 * Dependencies:
 *     - 004_booking_system.sql (practitioners)
 *
 * Used by:
 *     - src/lib/supabaseData.js (syncPractitionersFromJSONB)
 *     - supabase/functions/elevenlabs-tool (practitioner lookup)
 *
 * Changes:
 *     2026-03-11: Add bio text column to practitioners.
 */

ALTER TABLE public.practitioners
  ADD COLUMN IF NOT EXISTS bio text;
