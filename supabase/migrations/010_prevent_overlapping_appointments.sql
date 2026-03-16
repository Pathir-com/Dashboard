-- ============================================================
-- 010: Prevent overlapping appointments for the same practitioner
--
-- Uses the btree_gist extension + an EXCLUDE constraint so that
-- two non-cancelled appointments for the same practitioner
-- cannot have overlapping time ranges. This is the last line of
-- defence — the application code also checks, but race conditions
-- between concurrent requests can slip past application-level checks.
-- ============================================================

-- Required for GiST index on scalar + range columns
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Prevent overlapping time windows per practitioner (non-cancelled only).
-- Uses a partial exclusion constraint: only enforced where status != 'cancelled'.
ALTER TABLE public.appointments
  ADD CONSTRAINT no_overlapping_appointments
  EXCLUDE USING gist (
    practitioner_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (status <> 'cancelled');
