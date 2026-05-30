-- Capture the location preference on each appointment so multi-location
-- clinics (Berkeley: 5 sites; future similar) can see which site a patient
-- chose. Today's agent couldn't represent "Knightsbridge please" anywhere
-- structural so it kept re-asking; with this column plus the matching
-- tool args, the agent captures the choice and moves on.
--
-- Schema-light by design: the practitioner→location relationship is a
-- future iteration; for now the agent passes a free-text location and we
-- store it so the team has full context.
--
-- 2026-05-29

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN appointments.location IS
  'Patient-preferred location (free text, matched against practices.locations[].name). '
  'Used by multi-location clinics like Berkeley; null on single-location practices.';
