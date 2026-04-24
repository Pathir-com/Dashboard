-- Unpack every existing enquiries.conversation JSONB array into
-- enquiry_messages rows. Idempotent: skips any enquiry that already has
-- messages in the new table, so re-running this migration is safe and is
-- what the deploy workflow does on every push.
--
-- 2026-04-24

INSERT INTO enquiry_messages (enquiry_id, role, message, channel, created_at)
SELECT
  e.id,
  CASE
    WHEN LOWER(msg->>'role') IN ('agent', 'clinic', 'assistant', 'bot') THEN 'clinic'
    WHEN LOWER(msg->>'role') IN ('patient', 'user', 'customer', 'human') THEN 'patient'
    ELSE 'patient'
  END AS role,
  COALESCE(msg->>'message', msg->>'text', msg->>'content', '') AS message,
  COALESCE(msg->>'channel', e.source, 'unknown') AS channel,
  COALESCE(
    (msg->>'timestamp')::timestamptz,
    e.created_at
  ) AS created_at
FROM enquiries e
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.conversation, '[]'::jsonb)) AS msg
WHERE
  e.conversation IS NOT NULL
  AND jsonb_typeof(e.conversation) = 'array'
  AND jsonb_array_length(e.conversation) > 0
  AND COALESCE(msg->>'message', msg->>'text', msg->>'content', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM enquiry_messages em WHERE em.enquiry_id = e.id
  );
