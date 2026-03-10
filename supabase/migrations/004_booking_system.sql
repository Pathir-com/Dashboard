/**
 * Purpose:
 *     Normalises practitioners and services out of JSONB into proper tables,
 *     and creates the appointments + appointment_requests tables for the
 *     diary/booking system.
 *
 * Dependencies:
 *     - 001_initial_schema.sql (practices, profiles, enquiries)
 *     - 002_contacts.sql (contacts)
 *     - 003_contacts_identity.sql (date_of_birth, address, postcode on contacts)
 *
 * Used by:
 *     - api/availability.js (search available slots)
 *     - api/appointment-request.js (create/manage booking requests)
 *     - api/vapi-server-url.js (voice booking tools)
 *     - api/chatbase-action.js (chat booking actions)
 *
 * Changes:
 *     2026-03-10: Initial creation — practitioners, services, appointments,
 *                 appointment_requests tables with proper FKs and indexes.
 */

-- ============================================================
-- 1. Practitioners table
-- Normalised from practices.practitioners JSONB
-- ============================================================
CREATE TABLE IF NOT EXISTS public.practitioners (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     uuid        NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  title           text,                    -- "Dr", "Mr", etc.
  credentials     text,
  working_hours   jsonb       DEFAULT '{}',
  -- Format: { "monday": { "start": "09:00", "end": "17:00" }, "tuesday": null, ... }
  -- null or missing day = day off
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.practitioners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read own practitioners"
  ON public.practitioners FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = practitioners.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage own practitioners"
  ON public.practitioners FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = practitioners.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE INDEX idx_practitioners_practice ON public.practitioners(practice_id);

CREATE TRIGGER set_practitioners_updated_at
  BEFORE UPDATE ON public.practitioners
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 2. Services table
-- Normalised from practices.price_list JSONB
-- ============================================================
CREATE TABLE IF NOT EXISTS public.services (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id       uuid        NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  category          text        DEFAULT 'Private',  -- "NHS", "Private", "Hygiene"
  price_pence       integer,
  duration_minutes  integer     NOT NULL DEFAULT 30,
  buffer_minutes    integer     NOT NULL DEFAULT 10,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read own services"
  ON public.services FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = services.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage own services"
  ON public.services FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = services.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE INDEX idx_services_practice ON public.services(practice_id);

CREATE TRIGGER set_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 3. Practitioner–Service join table
-- Which practitioners can perform which services
-- ============================================================
CREATE TABLE IF NOT EXISTS public.practitioner_services (
  practitioner_id   uuid NOT NULL REFERENCES public.practitioners(id) ON DELETE CASCADE,
  service_id        uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (practitioner_id, service_id)
);

-- ============================================================
-- 4. Appointments table (the diary)
-- One row per booked slot
-- ============================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id       uuid        NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  practitioner_id   uuid        NOT NULL REFERENCES public.practitioners(id) ON DELETE CASCADE,
  service_id        uuid        NOT NULL REFERENCES public.services(id),
  contact_id        uuid        REFERENCES public.contacts(id),
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text        NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'pending', 'cancelled', 'completed')),
  notes             text,
  source            text        DEFAULT 'manual',  -- "phone", "chat", "manual", "online"
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read own appointments"
  ON public.appointments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = appointments.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage own appointments"
  ON public.appointments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = appointments.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

-- Primary query: "show me practitioner X's diary for date Y"
CREATE INDEX idx_appointments_practitioner_date
  ON public.appointments(practitioner_id, starts_at);

-- For contact history: "show me all appointments for patient Z"
CREATE INDEX idx_appointments_contact
  ON public.appointments(contact_id) WHERE contact_id IS NOT NULL;

CREATE INDEX idx_appointments_practice_date
  ON public.appointments(practice_id, starts_at);

CREATE TRIGGER set_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 5. Appointment requests table
-- Pending bookings that need team confirmation
-- ============================================================
CREATE TABLE IF NOT EXISTS public.appointment_requests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id                 uuid        NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  contact_id                  uuid        REFERENCES public.contacts(id),
  service_id                  uuid        REFERENCES public.services(id),
  preferred_practitioner_id   uuid        REFERENCES public.practitioners(id),
  preferred_date              date,
  preferred_time              text,       -- "morning", "afternoon", "14:00"
  is_urgent                   boolean     NOT NULL DEFAULT false,
  status                      text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'asap', 'confirmed', 'declined', 'rescheduled')),
  suggested_slots             jsonb       DEFAULT '[]',
  chosen_slot                 jsonb,
  backup_slot                 jsonb,
  notes                       text,
  submitted_outside_hours     boolean     NOT NULL DEFAULT false,
  confirmed_at                timestamptz,
  source                      text        DEFAULT 'phone',
  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now()
);

ALTER TABLE public.appointment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read own appointment requests"
  ON public.appointment_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = appointment_requests.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage own appointment requests"
  ON public.appointment_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = appointment_requests.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

-- ASAP requests surface first, then pending, ordered by creation
CREATE INDEX idx_appointment_requests_priority
  ON public.appointment_requests(practice_id, status, created_at);

CREATE TRIGGER set_appointment_requests_updated_at
  BEFORE UPDATE ON public.appointment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
