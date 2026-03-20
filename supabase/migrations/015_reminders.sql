-- Track when reminders were sent (prevents duplicates)
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz DEFAULT NULL;

-- SMS event tracking (mirrors email_events for unified follow-up display)
CREATE TABLE IF NOT EXISTS public.sms_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid REFERENCES practices(id),
  enquiry_id uuid REFERENCES enquiries(id),
  contact_id uuid REFERENCES contacts(id),
  appointment_id uuid REFERENCES appointments(id),
  sms_type text NOT NULL DEFAULT 'confirmation', -- confirmation, reminder, custom
  recipient_phone text NOT NULL,
  from_sender text, -- alpha sender name or phone number
  body text,
  status text DEFAULT 'sent', -- sent, delivered, failed
  twilio_sid text, -- Twilio message SID for tracking
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_events_enquiry ON sms_events(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_sms_events_appointment ON sms_events(appointment_id);

-- Schedule daily reminder job at 18:00 UTC (19:00 BST / 18:00 GMT)
-- Uses pg_cron to call the send-reminders edge function
SELECT cron.schedule(
  'daily-appointment-reminders',
  '0 18 * * *',
  $$SELECT net.http_post(
    url := 'https://amxcposgqlmgapzoopze.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"source":"cron"}'::jsonb
  )$$
);
