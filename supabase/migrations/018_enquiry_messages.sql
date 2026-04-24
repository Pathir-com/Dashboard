-- Messages are now first-class rows, not an append-only JSONB array on
-- enquiries. Normalising eliminates the read-modify-write race every webhook
-- suffered ("inbound SMS + AI reply land within 100ms, one silently
-- overwrites the other") and gives us per-message timestamps, idempotency
-- via provider_message_id, and row-level Realtime events for the dashboard.
--
-- 2026-04-24

CREATE TABLE IF NOT EXISTS enquiry_messages (
  id BIGSERIAL PRIMARY KEY,
  enquiry_id UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('patient', 'clinic', 'system')),
  message TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Order reads in-order without a sort.
CREATE INDEX IF NOT EXISTS enquiry_messages_enquiry_created_idx
  ON enquiry_messages (enquiry_id, created_at);

-- Gateways retry on their side — dedupe on (enquiry, provider id) when present.
CREATE UNIQUE INDEX IF NOT EXISTS enquiry_messages_provider_uniq
  ON enquiry_messages (enquiry_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- RLS: practice owners can read their own enquiries' messages. Edge functions
-- write via the service role, which bypasses RLS, so no INSERT/UPDATE policy
-- is needed. Messages are immutable by design (no UPDATE/DELETE policies).
ALTER TABLE enquiry_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read own enquiry messages" ON enquiry_messages;
CREATE POLICY "Owners can read own enquiry messages" ON enquiry_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enquiries e
      JOIN practices p ON p.id = e.practice_id
      WHERE e.id = enquiry_messages.enquiry_id
        AND p.owner_id = auth.uid()
    )
  );

-- Dashboard streams new messages live via Supabase Realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE enquiry_messages;
