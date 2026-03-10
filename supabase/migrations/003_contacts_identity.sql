-- Add identity and address fields to contacts for voice verification flow
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS postcode text;

CREATE INDEX IF NOT EXISTS idx_contacts_dob ON public.contacts(date_of_birth) WHERE date_of_birth IS NOT NULL;
