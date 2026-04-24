-- All writers and readers now operate on enquiry_messages. Drop the legacy
-- JSONB column so no future call site can quietly regress to the racy
-- read-modify-write pattern. Backfill (migration 019) must have completed
-- successfully before this runs.
--
-- 2026-04-24

ALTER TABLE enquiries DROP COLUMN IF EXISTS conversation;
