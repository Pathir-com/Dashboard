-- SMS trial routing for new signups.
--
-- New practices that sign up don't yet own an SMS number — but they need
-- to test the AI end-to-end during onboarding. We let them share the
-- platform-owned TextMagic number, and route inbound replies to the
-- correct practice by the sender's mobile (which we capture during
-- onboarding) instead of by the receiving number (which is shared with
-- Spark and any other live practice).
--
-- Lookup is checked BEFORE the existing recipient-number lookup in
-- textmagic-webhook (and any other shared-number webhook). TTL keeps the
-- table from growing unbounded — entries auto-expire after 24h. After
-- that, the user has to assign their own number to keep messaging.
--
-- 2026-05-04

CREATE TABLE IF NOT EXISTS sms_trial_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone text NOT NULL,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (user_phone)
);

-- Plain B-tree on (user_phone, expires_at) so the lookup `WHERE
-- user_phone = $1 AND expires_at > now()` is fast; a partial index using
-- now() in the predicate is rejected (now() isn't IMMUTABLE).
CREATE INDEX IF NOT EXISTS idx_sms_trial_routes_phone_expires
  ON sms_trial_routes (user_phone, expires_at);

ALTER TABLE sms_trial_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can read own trial routes" ON sms_trial_routes;
CREATE POLICY "Owner can read own trial routes" ON sms_trial_routes
  FOR SELECT
  USING (
    practice_id IN (
      SELECT id FROM practices WHERE owner_id = auth.uid()
    )
  );
