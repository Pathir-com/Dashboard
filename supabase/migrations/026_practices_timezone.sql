-- Per-practice IANA timezone. Phone bookings were storing the local
-- wall-clock the patient agreed on ("9am") as a naive datetime, which
-- Postgres timestamptz interpreted as UTC — so during BST every appointment
-- landed an hour late, and the bug would silently disappear in winter. We
-- store the practice's tz once, the toUtcIso helper uses it on the write
-- side, and formatLocal uses it on the read side. Default to Europe/London
-- because the platform is UK-only today; rest-of-world clinics override it
-- explicitly during onboarding.
--
-- 2026-05-25

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/London';

COMMENT ON COLUMN practices.timezone IS
  'IANA timezone name (e.g. Europe/London). Used by the booking tools to '
  'convert the wall-clock the patient agreed on to a UTC instant for storage, '
  'and back for display. DST-safe — never store a fixed offset here.';
