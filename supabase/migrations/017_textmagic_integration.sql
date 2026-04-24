-- Two-way SMS via TextMagic.
--
-- * Adds sms_deliveries table for delivery-status callbacks (both providers).
-- * Flips Spark Dental Clinic to TextMagic as the primary SMS provider —
--   Twilio stays configured for voice and as a fallback.
--
-- 2026-04-24

-- Delivery receipts from SMS providers. One row per provider message;
-- the status column advances as callbacks arrive (queued -> sent -> delivered).
CREATE TABLE IF NOT EXISTS sms_deliveries (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS sms_deliveries_phone_idx ON sms_deliveries (phone);
CREATE INDEX IF NOT EXISTS sms_deliveries_updated_idx ON sms_deliveries (updated_at DESC);

-- Spark Dental Clinic: enable TextMagic as primary SMS provider.
-- The TextMagic number +447418341716 forwards inbound voice to the Twilio
-- number, so this single patient-facing number serves both channels.
UPDATE practices
SET integrations = COALESCE(integrations, '{}'::jsonb) || jsonb_build_object(
  'sms_provider', 'textmagic',
  'textmagic', jsonb_build_object(
    'phone_number', '+447418341716',
    'sender_id', 'Spark Denta',
    'enabled', true,
    'ai_reply_enabled', true
  )
)
WHERE id = '7a2d6e46-5941-46a7-b858-88c0483b1e12';
