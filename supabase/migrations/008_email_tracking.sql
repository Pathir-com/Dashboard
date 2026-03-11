-- Email tracking: stores every email sent + delivery/open/click events
-- Links to enquiries so the dashboard can show follow-up status

CREATE TABLE IF NOT EXISTS public.email_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id    uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  practice_id    uuid REFERENCES public.practices(id),
  enquiry_id     uuid REFERENCES public.enquiries(id),
  contact_id     uuid REFERENCES public.contacts(id),
  conversation_id uuid,

  email_type     text NOT NULL,  -- 'new_patient_verification', 'appointment_confirmation', 'payment_link', 'receipt', 'follow_up'
  recipient_email text NOT NULL,
  from_email     text,
  subject        text,

  sent_at        timestamptz DEFAULT now(),
  delivered_at   timestamptz,
  opened_at      timestamptz,
  opened_count   integer DEFAULT 0,
  clicked_at     timestamptz,
  clicked_count  integer DEFAULT 0,
  click_urls     jsonb DEFAULT '[]'::jsonb,

  status         text NOT NULL DEFAULT 'sent',  -- 'sent', 'delivered', 'opened', 'clicked', 'failed'
  error_message  text,
  metadata       jsonb DEFAULT '{}'::jsonb,

  created_at     timestamptz DEFAULT now()
);

CREATE INDEX idx_email_events_practice ON public.email_events(practice_id);
CREATE INDEX idx_email_events_enquiry ON public.email_events(enquiry_id);
CREATE INDEX idx_email_events_tracking ON public.email_events(tracking_id);
CREATE INDEX idx_email_events_contact ON public.email_events(contact_id);

-- RLS
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view email events for their practice"
  ON public.email_events FOR SELECT
  USING (
    practice_id IN (
      SELECT p.id FROM public.practices p
      JOIN auth.users u ON u.id = p.owner_id
      WHERE u.id = auth.uid()
    )
  );

-- Allow service role full access (for edge functions)
CREATE POLICY "Service role full access on email_events"
  ON public.email_events FOR ALL
  USING (true)
  WITH CHECK (true);
