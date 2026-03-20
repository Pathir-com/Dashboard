ALTER TABLE public.practitioners
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS years_experience integer DEFAULT NULL;

COMMENT ON COLUMN practitioners.sort_order IS 'Seniority order (1 = most senior). Used for default practitioner allocation when no service mapping exists.';
COMMENT ON COLUMN practitioners.years_experience IS 'Years of professional experience. Shown in agent context and used for ranking.';
