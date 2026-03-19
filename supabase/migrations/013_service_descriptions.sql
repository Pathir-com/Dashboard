ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS description text DEFAULT '',
  ADD COLUMN IF NOT EXISTS patient_instructions text DEFAULT '';
