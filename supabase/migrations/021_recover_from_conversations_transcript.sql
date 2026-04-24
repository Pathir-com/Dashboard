-- Recovery migration.
--
-- Earlier today migration 020 dropped enquiries.conversation while the 019
-- backfill was partially running (one bad timestamp aborted the whole
-- transaction, and the workflow silently proceeded to 020). That left 35
-- enquiries with no message rows.
--
-- The conversations table still holds full transcripts (JSONB array of
-- {role, content, timestamp}) for every phone/web session that ran through
-- elevenlabs-conversation. 22 of those are linked to an enquiry via
-- enquiry_id. This migration unpacks those transcripts into enquiry_messages
-- so the dashboard shows them again.
--
-- Idempotent: skips any enquiry that already has messages.
--
-- 2026-04-24

INSERT INTO enquiry_messages (enquiry_id, role, message, channel, created_at)
SELECT
  c.enquiry_id,
  CASE
    WHEN LOWER(turn->>'role') IN ('user', 'patient', 'customer', 'human') THEN 'patient'
    ELSE 'clinic'
  END AS role,
  COALESCE(turn->>'content', turn->>'message', turn->>'text', '') AS message,
  COALESCE(c.channel, 'phone') AS channel,
  -- transcript rows store timestamp as seconds since call start. Add to
  -- started_at to get the real wall-clock time; fall back to started_at
  -- if the offset is missing or not numeric.
  CASE
    WHEN turn ? 'timestamp'
      AND jsonb_typeof(turn->'timestamp') = 'number'
    THEN COALESCE(c.started_at, NOW()) + ((turn->>'timestamp')::numeric || ' seconds')::interval
    ELSE COALESCE(c.started_at, NOW())
  END AS created_at
FROM conversations c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.transcript, '[]'::jsonb)) AS turn
WHERE
  c.enquiry_id IS NOT NULL
  AND c.transcript IS NOT NULL
  AND jsonb_typeof(c.transcript) = 'array'
  AND jsonb_array_length(c.transcript) > 0
  AND COALESCE(turn->>'content', turn->>'message', turn->>'text', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM enquiry_messages em WHERE em.enquiry_id = c.enquiry_id
  );
