-- SMS event tracking (mirrors email_events for unified follow-up display)
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.sms_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid REFERENCES practices(id),
  enquiry_id uuid REFERENCES enquiries(id),
  contact_id uuid REFERENCES contacts(id),
  appointment_id uuid REFERENCES appointments(id),
  sms_type text NOT NULL DEFAULT 'confirmation',
  recipient_phone text NOT NULL,
  from_sender text,
  body text,
  status text DEFAULT 'sent',
  twilio_sid text,
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_events_enquiry ON sms_events(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_sms_events_appointment ON sms_events(appointment_id);

-- Cron trigger: set up in Supabase Dashboard → Database → Extensions → pg_cron
-- Or use GitHub Actions scheduled workflow to POST to send-reminders daily at 18:00 UTC
