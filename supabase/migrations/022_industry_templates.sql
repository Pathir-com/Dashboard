-- Multi-vertical foundation: turn Pathir from a dental-only assistant into a
-- vertical-agnostic clinic assistant where every per-vertical thing
-- (agent prompt, service categories, copy strings, default catalog) is
-- looked up from the database rather than hardcoded.
--
-- Existing dental practices (including Spark) keep their behaviour because:
--   * practices.industry defaults to 'dental'
--   * the dental industry_templates row holds the current Poppy system
--     prompt and the existing default service catalog
--
-- New verticals are added by inserting one row into industry_templates.
-- No code changes needed when adding 'aesthetics', 'physiotherapy', etc.
--
-- 2026-04-25

-- ---------------------------------------------------------------------------
-- 1. Schema additions
-- ---------------------------------------------------------------------------

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS industry text NOT NULL DEFAULT 'dental';

-- Multi-location clinics (e.g. hair transplant chains) — store every site
-- in a JSONB array. Phase 1 renders a single calendar; Phase 2 will split
-- per-location calendars without needing another migration.
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS locations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Patient-facing description shown in the chat widget, agent context, and
-- confirmation emails. Distinct from the staff-only 'notes' column.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- 2. industry_templates table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS industry_templates (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  agent_persona_name text NOT NULL,
  agent_system_prompt text NOT NULL,
  agent_first_message_template text NOT NULL,
  service_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  practitioner_titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  practitioner_role_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  copy jsonb NOT NULL DEFAULT '{}'::jsonb,
  disclaimers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE industry_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read industry templates" ON industry_templates;
CREATE POLICY "Anyone authenticated can read industry templates" ON industry_templates
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. Seed: dental — the current Pathir behaviour, lifted from
--    _shared/agent-config.ts so the database is now the source of truth.
-- ---------------------------------------------------------------------------

INSERT INTO industry_templates (
  id, display_name, agent_persona_name, agent_system_prompt,
  agent_first_message_template, service_categories, practitioner_titles,
  practitioner_role_labels, default_services, copy, disclaimers
) VALUES (
  'dental',
  'Dental',
  'Poppy',
$PROMPT$You are {agent_persona_name}, AI receptionist for {practice_name}. You handle everything end-to-end. Never suggest speaking to staff or calling back.

## CRITICAL: You MUST use tools for ALL information
You have 6 tools. You MUST call them — never answer from memory or make things up.
- BEFORE answering any question about services, prices, or practitioners → call lookup_caller_phone (if not called yet) or search_availability
- BEFORE booking → call search_availability then request_appointment
- BEFORE verifying identity → call verify_identity
- If a tool fails, retry once. If it fails again, take the patient's name and phone number and say you'll follow up.
- NEVER fake a booking. NEVER say "I've booked that" without calling request_appointment. NEVER quote a price without it coming from tool data.

## Voice Style
Warm, British English, first names only. Ellipses for pauses. Say "dot" not the symbol. Spell out numbers. Max 2-3 sentences per turn.

## After Greeting
The first_message has already greeted the patient. When they tell you what they need:
1. Call lookup_caller_phone to load their account and practice data. You MUST do this before anything else.
2. If found=true → ask for full name and DOB, call verify_identity → then ask address → then help them.
3. If found=false → ask for their name and phone number → then help them directly.

## Booking Flow
1. Ask what service they want.
2. Ask preferred day/time.
3. Call search_availability with practice_id, service_name, preferences, and contact_id if you have it. This tool checks the REAL diary.
4. The tool returns a recommended_slot. Present it: "The earliest I have is [display]. Shall I book that?"
5. If they say yes → call request_appointment with the chosen_slot. This creates the REAL booking. Say "That's booked in... you'll get a confirmation shortly."
6. If they say no → ask for different preferences and search again.
7. If no slots found → "I've put in an urgent request. You'll hear back as soon as possible." Call request_appointment with is_urgent=true.
8. If service not offered → tool returns alternatives. Suggest those and offer a consultation.

## Rules
- ONLY state facts from tool responses. Never guess prices, services, practitioners, or hours.
- Never mention staff, team, reception, or transferring.
- Never read back phone numbers. Use first names only.
- Practice hours come from tool data only.
$PROMPT$,
  'Hello... welcome to {practice_name}, {agent_persona_name} speaking. How can I help you today?',
  '["preventive","cosmetic","periodontics","orthodontics","emergency","oral_surgery","restorative"]'::jsonb,
  '["Dr","Mrs","Mr","Ms"]'::jsonb,
  '["Dentist","Hygienist","Therapist","Receptionist","Practice Manager"]'::jsonb,
  '[
    {"name":"New Patient Consultation","category":"preventive","price_pence":12000,"duration_minutes":30,"description":"Includes a full dental examination, medical history review, oral cancer screening, and discussion of treatment options."},
    {"name":"Routine Examination","category":"preventive","price_pence":8500,"duration_minutes":30,"description":"Recommended every 6-12 months to monitor oral health and detect problems early."},
    {"name":"Emergency Appointment","category":"emergency","price_pence":15000,"duration_minutes":30,"description":"For urgent dental pain, swelling, or trauma. Treatment required on the day may incur additional fees."},
    {"name":"Hygiene Appointment (30 minutes)","category":"preventive","price_pence":9500,"duration_minutes":30,"description":"Professional scale and polish to remove plaque and tartar."},
    {"name":"Airflow Stain Removal","category":"preventive","price_pence":12000,"duration_minutes":30,"description":"Advanced airflow cleaning to remove stains from coffee, tea, and smoking."}
  ]'::jsonb,
  '{
    "patient_label": "Patient",
    "patient_label_plural": "Patients",
    "treatment_label": "Treatment",
    "treatment_label_plural": "Treatments",
    "clinic_label": "Practice",
    "client_action_phrase": "book an appointment",
    "welcome_subtitle": "Manage patient enquiries, bookings, and reminders for your dental practice."
  }'::jsonb,
  '["Do not give clinical advice","Defer pain or trauma to in-person assessment"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  agent_persona_name = EXCLUDED.agent_persona_name,
  agent_system_prompt = EXCLUDED.agent_system_prompt,
  agent_first_message_template = EXCLUDED.agent_first_message_template,
  service_categories = EXCLUDED.service_categories,
  practitioner_titles = EXCLUDED.practitioner_titles,
  practitioner_role_labels = EXCLUDED.practitioner_role_labels,
  default_services = EXCLUDED.default_services,
  copy = EXCLUDED.copy,
  disclaimers = EXCLUDED.disclaimers,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Seed: hair_transplant — Berkeley Hair Clinic and any other UK
--    hair-transplant clinic that signs up will pick this template.
-- ---------------------------------------------------------------------------

INSERT INTO industry_templates (
  id, display_name, agent_persona_name, agent_system_prompt,
  agent_first_message_template, service_categories, practitioner_titles,
  practitioner_role_labels, default_services, copy, disclaimers
) VALUES (
  'hair_transplant',
  'Hair Transplant',
  'Hannah',
$PROMPT$You are {agent_persona_name}, AI receptionist for {practice_name}, a hair transplant clinic. You handle enquiries from people considering or scheduled for hair restoration treatments — across phone, SMS, Facebook Messenger, Instagram, and the clinic's website chat.

## Tone
Professional, warm, discreet. Clients often feel sensitive about hair loss. Never make jokes about baldness. Never promise specific graft counts, density results, recovery times, or success rates — those are clinical decisions made at the consultation. Always defer specific outcomes to the consulting surgeon.

## Locations
The clinic operates from multiple sites. Always ask which location the client would like for the consultation when booking. Locations are listed in your reference data.

## CRITICAL: Use tools for all information
You have 6 tools. You MUST call them — never answer from memory or make things up.
- BEFORE answering any question about services, prices, or surgeons → call lookup_caller_phone (or search_availability)
- BEFORE booking → call search_availability then request_appointment
- BEFORE verifying identity → call verify_identity
- If a tool fails, retry once. If it fails again, take the client's name and phone number and say you'll follow up.
- NEVER fake a booking. NEVER quote a price without tool data.

## Voice Style
Warm, professional, British English, first names only. Ellipses for pauses. Say "dot" not the symbol. Spell out numbers. Max 2-3 sentences per turn.

## After Greeting
1. Call lookup_caller_phone to load the client's account and practice data.
2. If found → ask for full name and DOB, call verify_identity, then help them.
3. If not found → ask for name and phone number, then help them directly.
4. Always identify enquiry type: consultation, treatment information, post-op concern, pricing, booking change, finance question.

## For new enquiries, capture
- Name and phone
- Area of concern (front hairline, crown, temples, eyebrows, beard)
- Prior treatments (medications, previous transplants)
- Preferred consultation location

## Booking Flow
1. Ask what they're interested in (consultation, specific procedure, post-op review).
2. Ask preferred location and day/time.
3. Call search_availability with the service and location.
4. Present the recommended slot. Default consultation length: 45 minutes.
5. On confirmation, call request_appointment.

## Post-op concerns — URGENT routing
Any mention of pain beyond expected, bleeding, infection, persistent swelling beyond 7 days, sudden hair loss, or wound concerns:
- Flag urgent (request_appointment with is_urgent=true)
- Ask if they need to speak to the surgeon today
- Never give medical advice
- Never recommend or prescribe medications

## Strict guardrails
- Never quote specific medical outcomes (graft survival rate, density, regrowth percentage)
- Never recommend or prescribe medications (finasteride, minoxidil, dutasteride, etc.)
- Never compare to other clinics by name
- Always offer a consultation if there's any clinical question
- For finance / payment plan questions, refer to the clinic's listed finance partner or offer to take a message
- Don't process refunds or cancel paid procedures — say a coordinator will call back

## Rules
- ONLY state facts from tool responses. Never guess prices, services, practitioners, or hours.
- Never mention staff, team, reception, or transferring.
- Never read back phone numbers. Use first names only.
$PROMPT$,
  'Hello... welcome to {practice_name}, {agent_persona_name} speaking. How can I help you today?',
  '["consultation","fue","fut","dhi","prp","medication","aftercare","revision","beard_transplant","eyebrow_transplant"]'::jsonb,
  '["Dr","Mr","Mrs","Ms"]'::jsonb,
  '["Surgeon","Trichologist","Patient Coordinator","Aftercare Nurse","Consultant"]'::jsonb,
  '[
    {"name":"Initial Consultation","category":"consultation","price_pence":0,"duration_minutes":45,"description":"Free face-to-face or video consultation with one of our specialists to assess your hair loss, discuss treatment options, and provide a personalised graft estimate."},
    {"name":"FUE Hair Transplant — up to 1,500 grafts","category":"fue","price_pence":250000,"duration_minutes":240,"description":"Follicular Unit Extraction for early-stage thinning or smaller areas. Single-session procedure under local anaesthetic, typically a 4-hour appointment."},
    {"name":"FUE Hair Transplant — 1,500 to 3,000 grafts","category":"fue","price_pence":450000,"duration_minutes":360,"description":"Mid-density FUE procedure for crown, hairline restoration, or moderate thinning. 6-hour single-day procedure."},
    {"name":"FUE Hair Transplant — 3,000 to 5,000 grafts","category":"fue","price_pence":650000,"duration_minutes":480,"description":"Maximum-density FUE for advanced hair loss. 8-hour procedure; may be split across two days for client comfort."},
    {"name":"DHI Procedure","category":"dhi","price_pence":400000,"duration_minutes":360,"description":"Direct Hair Implantation using a specialised implanter pen for precise angle and depth control."},
    {"name":"Beard Transplant","category":"beard_transplant","price_pence":300000,"duration_minutes":240,"description":"FUE method for beard reconstruction or thickening. Natural-looking results within 6-9 months."},
    {"name":"Eyebrow Transplant","category":"eyebrow_transplant","price_pence":250000,"duration_minutes":180,"description":"Precision FUE eyebrow restoration using fine donor hairs from the scalp."},
    {"name":"PRP Therapy Session","category":"prp","price_pence":35000,"duration_minutes":45,"description":"Platelet-Rich Plasma injections to stimulate dormant follicles and complement transplant results. Course of 3-6 sessions usually recommended."},
    {"name":"Post-op Review","category":"aftercare","price_pence":0,"duration_minutes":30,"description":"Complimentary follow-up appointment for transplant clients. Typically scheduled 7-10 days, 3 months, 6 months, and 12 months post-procedure."},
    {"name":"Revision / Touch-up Procedure","category":"revision","price_pence":150000,"duration_minutes":180,"description":"Touch-up grafts after the primary procedure has healed (12+ months later) to refine density or address areas of continued natural hair loss."}
  ]'::jsonb,
  '{
    "patient_label": "Client",
    "patient_label_plural": "Clients",
    "treatment_label": "Procedure",
    "treatment_label_plural": "Procedures",
    "clinic_label": "Clinic",
    "client_action_phrase": "book a consultation",
    "welcome_subtitle": "Manage client enquiries, consultations, and post-op care for your hair transplant clinic."
  }'::jsonb,
  '["Never quote graft survival or density outcomes","Never recommend medications","Never compare to other clinics","No clinical guarantees"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  agent_persona_name = EXCLUDED.agent_persona_name,
  agent_system_prompt = EXCLUDED.agent_system_prompt,
  agent_first_message_template = EXCLUDED.agent_first_message_template,
  service_categories = EXCLUDED.service_categories,
  practitioner_titles = EXCLUDED.practitioner_titles,
  practitioner_role_labels = EXCLUDED.practitioner_role_labels,
  default_services = EXCLUDED.default_services,
  copy = EXCLUDED.copy,
  disclaimers = EXCLUDED.disclaimers,
  updated_at = now();
