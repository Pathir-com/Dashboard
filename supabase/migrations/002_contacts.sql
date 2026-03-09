-- Unified patient/contact profile across all channels
-- Matches by phone, email, or name to link conversations together

CREATE TABLE public.contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     uuid        NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  phone           text,
  email           text,
  source          text        DEFAULT 'chat',   -- first seen via: phone, chat, email, facebook, instagram
  notes           text        DEFAULT '',
  tags            jsonb       DEFAULT '[]'::jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read own contacts"
  ON public.contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = contacts.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can create contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = contacts.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update own contacts"
  ON public.contacts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = contacts.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE INDEX idx_contacts_practice_id ON public.contacts(practice_id);
CREATE INDEX idx_contacts_phone ON public.contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_contacts_email ON public.contacts(email) WHERE email IS NOT NULL;

CREATE TRIGGER set_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Link enquiries to contacts
ALTER TABLE public.enquiries ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id);
CREATE INDEX IF NOT EXISTS idx_enquiries_contact_id ON public.enquiries(contact_id);
