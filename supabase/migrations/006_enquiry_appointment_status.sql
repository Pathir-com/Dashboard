/**
 * Purpose:
 *     Add appointment_status column to enquiries so the inbox can show
 *     yellow (pending) vs green (confirmed) for booked appointments.
 *     Also add appointment_request_id to link the enquiry to the request.
 *
 * Dependencies:
 *     - 001_initial_schema.sql (enquiries)
 *     - 004_booking_system.sql (appointment_requests)
 *
 * Used by:
 *     - src/components/clinic/AppointmentStatus.jsx
 *     - supabase/functions/elevenlabs-tool (request_appointment)
 *     - src/lib/supabaseData.js (confirmAppointmentRequest)
 *
 * Changes:
 *     2026-03-11: Add appointment_status and appointment_request_id columns.
 */

ALTER TABLE public.enquiries
  ADD COLUMN IF NOT EXISTS appointment_status text
    CHECK (appointment_status IN ('pending', 'confirmed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS appointment_request_id uuid
    REFERENCES public.appointment_requests(id),
  ADD COLUMN IF NOT EXISTS contact_id uuid
    REFERENCES public.contacts(id);
