# Phone Integration — Data Flow & UI

## Overview

Each dental practice gets a permanently assigned UK Twilio phone number. The number
stays with the practice until the account is deleted — it is never released to the pool.
The practice owner can **disconnect** (deactivate AI routing) and **reconnect** at will.

---

## Database Fields (source of truth: `practices` table)

| Column | Type | Description |
|---|---|---|
| `twilio_phone_number` | `text` | Permanently assigned Twilio number (E.164). Set once by `twilio-assign-number`. Never cleared except on account delete. |
| `phone` | `text` | The clinic's own landline / contact number. Editable by the user. Unrelated to the AI agent. |
| `integrations` → `phone_enabled` | `bool` (JSONB) | `true` = calls routed to VAPI → ElevenLabs AI agent. `false` = calls hear "not available" TwiML message. |
| `integrations` → `sms_enabled` | `bool` (JSONB) | `true` = inbound SMS processed by AI. `false` = auto-reply "doesn't receive texts". |

---

## Call Routing

### Connected (`phone_enabled = true`)

```
Caller → Twilio → VoiceUrl = api.vapi.ai/twilio/inbound_call → Poppy (ElevenLabs) answers
                                          ↓ (call ends)
                                    vapi-webhook → creates enquiry in Supabase
```

### Disconnected (`phone_enabled = false`)

```
Caller → Twilio → VoiceUrl = supabase.co/functions/v1/twilio-disconnected-voice
                  → TwiML: "Thank you for calling [practice]. Our automated receptionist
                    is not currently available. Please visit our website or call directly."
```

### SMS (`sms_enabled = true`)

```
SMS → Twilio → twilio-sms-webhook → lookup practice by number → create enquiry → auto-reply
```

### SMS (`sms_enabled = false`)

```
SMS → Twilio → twilio-sms-webhook → lookup practice → reply: "doesn't receive texts"
```

---

## Edge Functions

| Function | Purpose | Trigger |
|---|---|---|
| `twilio-assign-number` | Buy/pool a UK number, assign to practice, set VoiceUrl to VAPI | Dashboard: first-time phone enable |
| `twilio-toggle-number` | Flip VoiceUrl between VAPI and disconnected-voice, update `phone_enabled` | Dashboard: disconnect/reconnect |
| `twilio-disconnected-voice` | Return TwiML "not available" message with practice name | Twilio webhook (inbound call when disconnected) |
| `twilio-release-number` | Legacy compat — same as toggle with `enable=false` | Old clients |
| `twilio-sms-webhook` | Handle inbound SMS, create enquiry | Twilio SMS webhook |
| `vapi-webhook` | Handle end-of-call report from VAPI, create enquiry | VAPI post-call |

---

## UI Flow

### Integrations Tab — Phone Agent Card

```
State: No number assigned
  → Click card → calls onAssignNumber() → twilio-assign-number edge fn
  → Number assigned, phone_enabled = true

State: Number assigned, connected (phone_enabled = true)
  → Click card → opens panel
  → Shows: number with Copy button, green "Connected" badge
  → "Disconnect" button → calls togglePhoneAgent(id, false)
  → Twilio VoiceUrl → disconnected-voice, phone_enabled = false

State: Number assigned, disconnected (phone_enabled = false)
  → Click card → opens panel
  → Shows: number with Copy button, amber "Disconnected" badge
  → Warning: "Callers will hear a message that the receptionist is unavailable"
  → "Reconnect" button → calls togglePhoneAgent(id, true)
  → Twilio VoiceUrl → VAPI, phone_enabled = true
```

### Clinic Details Tab — Phone Section

- **Clinic Phone**: Always-editable input for `practice.phone` (the landline)
- **AI Phone Number**: Read-only display of `practice.twilio_phone_number` with:
  - Copy button
  - Green "Active" / amber "Inactive" badge based on `phone_enabled`

---

## Files Changed (2026-03-18)

### New files
- `supabase/functions/twilio-disconnected-voice/index.ts`
- `supabase/functions/twilio-toggle-number/index.ts`
- `docs/phone-integration.md`

### Modified files
- `supabase/functions/twilio-release-number/index.ts` — rewritten to disconnect only (no longer clears number)
- `src/lib/twilioService.js` — replaced `releaseTwilioNumber` with `togglePhoneAgent`
- `src/components/clinic/settings/IntegrationsTab.jsx` — phone disconnect/reconnect panel
- `src/components/clinic/settings/ClinicDetailsTab.jsx` — AI phone number display with copy
- `src/components/clinic/ClinicSettings.jsx` — passes `practice` prop to ClinicDetailsTab
