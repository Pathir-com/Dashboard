-- ============================================================
-- Pathir - Dental Practice Management SaaS
-- Initial Schema Migration
-- ============================================================

-- ============================================================
-- 1. Helper: updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. Profiles table (extends auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text        NOT NULL,
  role        text        NOT NULL DEFAULT 'clinic_owner'
                          CHECK (role IN ('admin', 'clinic_owner')),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- updated_at trigger
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 3. Practices table
-- ============================================================
CREATE TABLE public.practices (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name                    text        NOT NULL,
  address                 text,
  phone                   text,
  email                   text,
  website                 text,
  practice_type           text        DEFAULT 'Private',
  opening_hours           jsonb       DEFAULT '[]'::jsonb,
  holiday_hours           jsonb       DEFAULT '[]'::jsonb,
  practitioners           jsonb       DEFAULT '[]'::jsonb,
  price_list              jsonb       DEFAULT '[]'::jsonb,
  integrations            jsonb       DEFAULT '{}'::jsonb,
  usps                    text        DEFAULT '',
  practice_plan           jsonb       DEFAULT '{"offered": false, "terms": ""}'::jsonb,
  chatbase_agent_id       text        DEFAULT '',
  elevenlabs_agent_id     text        DEFAULT '',
  twilio_phone_number     text        DEFAULT '',
  stripe_subscription_id  text        DEFAULT '',
  onboarding_completed    boolean     DEFAULT false,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

ALTER TABLE public.practices ENABLE ROW LEVEL SECURITY;

-- Owners can select their own practices
CREATE POLICY "Owners can read own practices"
  ON public.practices FOR SELECT
  USING (auth.uid() = owner_id);

-- Owners can insert practices they own
CREATE POLICY "Owners can create practices"
  ON public.practices FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Owners can update their own practices
CREATE POLICY "Owners can update own practices"
  ON public.practices FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Owners can delete their own practices
CREATE POLICY "Owners can delete own practices"
  ON public.practices FOR DELETE
  USING (auth.uid() = owner_id);

-- Index for owner lookups
CREATE INDEX idx_practices_owner_id ON public.practices(owner_id);

-- updated_at trigger
CREATE TRIGGER set_practices_updated_at
  BEFORE UPDATE ON public.practices
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 4. Enquiries table
-- ============================================================
CREATE TABLE public.enquiries (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id             uuid        NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_name            text        NOT NULL,
  phone_number            text,
  message                 text,
  source                  text        DEFAULT 'phone',
  is_urgent               boolean     DEFAULT false,
  is_completed            boolean     DEFAULT false,
  conversation            jsonb       DEFAULT '[]'::jsonb,
  selected_service        text,
  appointment_datetime    timestamptz,
  practitioner            text,
  confirmation_sent       boolean     DEFAULT false,
  confirmation_sent_date  timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

-- Owners can select enquiries for their practices
CREATE POLICY "Owners can read own enquiries"
  ON public.enquiries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = enquiries.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

-- Owners can insert enquiries for their practices
CREATE POLICY "Owners can create enquiries"
  ON public.enquiries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = enquiries.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

-- Owners can update enquiries for their practices
CREATE POLICY "Owners can update own enquiries"
  ON public.enquiries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = enquiries.practice_id
        AND practices.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = enquiries.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

-- Owners can delete enquiries for their practices
CREATE POLICY "Owners can delete own enquiries"
  ON public.enquiries FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = enquiries.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

-- Index for practice lookups
CREATE INDEX idx_enquiries_practice_id ON public.enquiries(practice_id);

-- updated_at trigger
CREATE TRIGGER set_enquiries_updated_at
  BEFORE UPDATE ON public.enquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 5. Auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
