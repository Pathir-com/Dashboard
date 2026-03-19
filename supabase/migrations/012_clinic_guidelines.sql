ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS clinic_guidelines text DEFAULT '',
  ADD COLUMN IF NOT EXISTS agent_tone text DEFAULT '';
