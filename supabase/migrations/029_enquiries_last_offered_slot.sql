-- Persist the last slot offered by search_availability on the enquiry row,
-- so subsequent SMS turns (each on a fresh ConvAI WebSocket — no in-agent
-- memory) can read the structured slot fields and call request_appointment
-- without re-running search.
--
-- Without this, the LLM only sees prose like "Saturday at 10 with Andre"
-- in the conversation history and can't reconstruct slot_date /
-- slot_start_time / practitioner_id / service_id, so the booking commit
-- never happens. Set by handleSearchAvailability when a slot is offered;
-- cleared by handleRequestAppointment on a successful commit.
--
-- 2026-05-29

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS last_offered_slot JSONB;

COMMENT ON COLUMN enquiries.last_offered_slot IS
  'Structured slot the agent most recently offered the patient (set by '
  'search_availability, cleared by request_appointment on success). Shape: '
  '{ slot_date, slot_start_time, slot_end_time, practitioner_id, '
  'practitioner_name, service_id, service_name, preferred_location? }. '
  'Used to feed the next SMS turn the slot args it needs to book.';
