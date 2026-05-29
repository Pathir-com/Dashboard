-- Back-correct phone appointments that were stored with the wrong UTC
-- instant before migration 026's helper landed.
--
-- Bug recap: request_appointment built a NAIVE "YYYY-MM-DDTHH:MM:00" string;
-- Postgres timestamptz read it as UTC, so during BST every phone booking
-- landed an hour late (09:00+00 stored == 10:00 Europe/London). In winter
-- (GMT=UTC) the same code accidentally works. From 2026-05-29 onward the
-- code converts via toUtcIso(...practice.timezone) so new rows are correct.
--
-- This migration repairs the affected rows. ADDITIVE, not destructive:
--   * Adds tz_corrected_from to preserve the original starts_at (audit /
--     reversible — set starts_at = tz_corrected_from to undo).
--   * Idempotent: skips rows already corrected (tz_corrected_from NOT NULL).
--   * Scoped tight: source='phone' (the affected writer), created before the
--     fix deploy (so we never touch correct new rows), and starts_at lands
--     inside UK BST 2026 (where the bug actually manifested — winter rows
--     were accidentally fine).
--
-- 2026-05-29

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS tz_corrected_from TIMESTAMPTZ;

COMMENT ON COLUMN appointments.tz_corrected_from IS
  'Original starts_at preserved when migration 027 subtracted 1 hour to fix '
  'the BST-era naive-datetime bug. Reversible: set starts_at = tz_corrected_from to undo.';

UPDATE appointments
   SET tz_corrected_from = starts_at,
       starts_at         = starts_at - INTERVAL '1 hour',
       ends_at           = ends_at   - INTERVAL '1 hour'
 WHERE source = 'phone'
   AND tz_corrected_from IS NULL
   AND created_at < '2026-05-29T02:00:00Z'
   AND (starts_at AT TIME ZONE 'Europe/London')::date
         BETWEEN '2026-03-29' AND '2026-10-25';
