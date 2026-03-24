/**
 * ElevenLabs agent configuration — system prompt and tool definitions.
 * Used by provision-practice to create agents via API.
 * Mirrors api/_lib/elevenlabs-assistant-config.js but in Deno-compatible TypeScript.
 */

export function generateSystemPrompt(clinicName: string, assistantName = "Poppy"): string {
  return `You are ${assistantName}, AI receptionist for ${clinicName}. You handle everything end-to-end. Never suggest speaking to staff or calling back.

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
`;
}

export function buildToolDefinitions(supabaseFunctionsUrl: string) {
  const baseUrl = `${supabaseFunctionsUrl}/elevenlabs-tool`;
  return [
    {
      type: "webhook",
      name: "lookup_caller_phone",
      description: "Look up the patient and load practice data. MUST be called at the start of EVERY conversation (phone or web chat). Pass the caller's phone number if available. For web chat: pass practice_id, visitor_name, visitor_phone, contact_id from dynamic variables.",
      api_schema: {
        url: `${baseUrl}?tool=lookup_caller_phone`,
        method: "POST",
        request_body_schema: {
          type: "object",
          properties: {
            caller_phone: { type: "string", description: "The caller's phone number if known" },
            practice_id: { type: "string", description: "The practice ID (from dynamic variables for web chat)" },
            contact_id: { type: "string", description: "The contact ID if already known" },
            visitor_name: { type: "string", description: "The visitor's name (web chat)" },
            visitor_phone: { type: "string", description: "The visitor's phone number (web chat)" },
            visitor_email: { type: "string", description: "The visitor's email (web chat)" },
            channel: { type: "string", description: "The channel: phone or web_chat" },
          },
          required: [],
        },
      },
    },
    {
      type: "webhook",
      name: "lookup_account_phone",
      description: "Look up a patient account by a phone number they provide.",
      api_schema: {
        url: `${baseUrl}?tool=lookup_account_phone`,
        method: "POST",
        request_body_schema: {
          type: "object",
          properties: {
            practice_id: { type: "string", description: "The practice ID" },
            account_phone: { type: "string", description: "The phone number the patient says is on their account" },
          },
          required: ["practice_id", "account_phone"],
        },
      },
    },
    {
      type: "webhook",
      name: "verify_identity",
      description: "Verify the caller's identity by checking name and DOB against the contact record.",
      api_schema: {
        url: `${baseUrl}?tool=verify_identity`,
        method: "POST",
        request_body_schema: {
          type: "object",
          properties: {
            contact_id: { type: "string", description: "The contact ID from the lookup result" },
            stated_name: { type: "string", description: "The full name the caller stated" },
            stated_dob: { type: "string", description: "DOB in YYYY-MM-DD format" },
          },
          required: ["contact_id", "stated_name", "stated_dob"],
        },
      },
    },
    {
      type: "webhook",
      name: "update_address",
      description: "Update a patient's address on file.",
      api_schema: {
        url: `${baseUrl}?tool=update_address`,
        method: "POST",
        request_body_schema: {
          type: "object",
          properties: {
            contact_id: { type: "string", description: "The contact ID" },
            new_address: { type: "string", description: "The full new address" },
            new_postcode: { type: "string", description: "The new postcode" },
          },
          required: ["contact_id", "new_address"],
        },
      },
    },
    {
      type: "webhook",
      name: "search_availability",
      description: "Search the diary for available appointment slots. Checks REAL availability.",
      api_schema: {
        url: `${baseUrl}?tool=search_availability`,
        method: "POST",
        request_body_schema: {
          type: "object",
          properties: {
            practice_id: { type: "string", description: "The practice ID" },
            service_name: { type: "string", description: "The service the patient wants" },
            preference_day: { type: "string", description: "Preferred day of the week" },
            preference_time: { type: "string", description: "morning, afternoon, or specific time like 14:00" },
            preference_date: { type: "string", description: "Specific date in YYYY-MM-DD" },
            is_urgent: { type: "boolean", description: "True if urgent" },
          },
          required: ["service_name"],
        },
      },
    },
    {
      type: "webhook",
      name: "request_appointment",
      description: "Book the appointment. MUST be called when the patient agrees to a slot. Copy the slot fields from search_availability result. Creates the REAL booking.",
      api_schema: {
        url: `${baseUrl}?tool=request_appointment`,
        method: "POST",
        request_body_schema: {
          type: "object",
          properties: {
            practice_id: { type: "string", description: "The practice ID" },
            contact_id: { type: "string", description: "The contact ID" },
            service_id: { type: "string", description: "The service_id from search_availability" },
            enquiry_id: { type: "string", description: "The enquiry_id from lookup" },
            slot_practitioner_id: { type: "string", description: "The practitioner_id of the chosen slot" },
            slot_date: { type: "string", description: "The date in YYYY-MM-DD" },
            slot_start_time: { type: "string", description: "The start_time in HH:MM" },
            slot_end_time: { type: "string", description: "The end_time in HH:MM" },
            slot_practitioner_name: { type: "string", description: "The practitioner name" },
            is_urgent: { type: "boolean", description: "True if urgent" },
          },
          required: ["service_id", "slot_date", "slot_start_time"],
        },
      },
    },
  ];
}
