/**
 * Purpose:
 *     Conversation history table for cross-channel memory (RAG).
 *     Stores every phone call and web chat session with transcript,
 *     AI-generated summary, and outcome classification.
 *
 * Dependencies:
 *     - 001_initial_schema.sql (practices, enquiries)
 *     - 002_contacts.sql (contacts)
 *     - 004_booking_system.sql (appointments, appointment_requests)
 *
 * Used by:
 *     - supabase/functions/elevenlabs-tool (RAG context in lookup tools)
 *     - supabase/functions/elevenlabs-conversation (post-call webhook)
 *     - src/components/clinic/InboxView.jsx (dashboard conversation history)
 *
 * Changes:
 *     2026-03-11: Initial creation — conversations table with indexes
 *                 for known (contact_id) and unknown (caller_phone) search.
 */

-- ============================================================
-- Conversations table — one row per phone call or web chat session
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id                 uuid        NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  -- Patient link: set when identity is verified, nullable for unknown callers
  contact_id                  uuid        REFERENCES public.contacts(id),

  -- ElevenLabs session tracking
  elevenlabs_conversation_id  text        UNIQUE,

  -- Channel and status
  channel                     text        NOT NULL DEFAULT 'phone'
                              CHECK (channel IN ('phone', 'web_chat', 'sms')),
  status                      text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed', 'missed', 'error')),
  outcome                     text
                              CHECK (outcome IN ('booking_made', 'enquiry_only', 'no_resolution', 'callback_requested', 'transferred')),

  -- For unknown contacts — still searchable by phone or name
  caller_name                 text,
  caller_phone                text,

  -- AI-generated at end of conversation
  summary                     text,

  -- Full message history: [{role: "agent"|"user", content: "...", timestamp: "..."}]
  transcript                  jsonb       DEFAULT '[]'::jsonb,

  -- Links to related records
  appointment_id              uuid        REFERENCES public.appointments(id),
  enquiry_id                  uuid        REFERENCES public.enquiries(id),

  -- Timing
  started_at                  timestamptz DEFAULT now(),
  ended_at                    timestamptz,
  duration_seconds            integer,

  -- Extensible metadata: sentiment, topics discussed, urgency, etc.
  metadata                    jsonb       DEFAULT '{}'::jsonb,

  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read own conversations"
  ON public.conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = conversations.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage own conversations"
  ON public.conversations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.practices
      WHERE practices.id = conversations.practice_id
        AND practices.owner_id = auth.uid()
    )
  );

-- ── Indexes for RAG + dashboard queries ──

-- 1. Dashboard: filter by status (active, completed, etc.)
CREATE INDEX idx_conversations_practice_status
  ON public.conversations(practice_id, status);

-- 2. RAG: fetch all past conversations for a known patient
CREATE INDEX idx_conversations_contact
  ON public.conversations(contact_id, started_at DESC)
  WHERE contact_id IS NOT NULL;

-- 3. RAG: match unknown callers by phone number
CREATE INDEX idx_conversations_caller_phone
  ON public.conversations(caller_phone, started_at DESC)
  WHERE caller_phone IS NOT NULL;

-- 4. Analytics: conversations that led to bookings vs no resolution
CREATE INDEX idx_conversations_practice_outcome
  ON public.conversations(practice_id, outcome);

-- 5. Channel filter: phone vs web chat
CREATE INDEX idx_conversations_practice_channel
  ON public.conversations(practice_id, channel);

-- 6. Time-based: recent conversations first
CREATE INDEX idx_conversations_started
  ON public.conversations(started_at DESC);

-- 7. Full-text search on AI summaries
CREATE INDEX idx_conversations_summary_gin
  ON public.conversations USING gin (to_tsvector('english', coalesce(summary, '')));

-- 8. ElevenLabs conversation ID lookup (for webhook matching)
-- Already covered by the UNIQUE constraint, but explicit for clarity
CREATE INDEX idx_conversations_el_id
  ON public.conversations(elevenlabs_conversation_id)
  WHERE elevenlabs_conversation_id IS NOT NULL;

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
