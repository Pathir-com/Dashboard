-- Add SMS-related columns to practices table
-- twilio_sms_number: UK mobile number for two-way SMS
-- messaging_service_sid: Twilio Messaging Service SID (holds alpha sender + mobile number)

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS twilio_sms_number     text DEFAULT '',
  ADD COLUMN IF NOT EXISTS messaging_service_sid  text DEFAULT '';
