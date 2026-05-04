# Pathir end-to-end tests

Vitest suite that exercises signup → onboarding → provisioning → SMS → number assignment → multi-account isolation against the **live** Supabase project, ElevenLabs API, and Twilio Mint Dental account.

## Run

```bash
# One-time: write .env.test with the credentials Mgmt API masks
cp .env.test.example .env.test
# Then fill in ELEVENLABS_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

npm test                # run everything (some tests skip without target phone / VAPI)
npm run test:wipe       # idempotent cleanup if a run crashes
```

## What's covered

| File | What it tests | External calls |
|---|---|---|
| `01-signup.test.ts` | Multi-user creation, sign-in, RLS isolation | Supabase only |
| `02-onboarding.test.ts` | Practice insert, `provision-practice`, ElevenLabs agent shape, vertical persona | + ElevenLabs |
| `03-sms-twoway.test.ts` | `intro-test-sms` auth/ownership, trial-route schema, `textmagic-webhook` routing → enquiry creation | + ElevenLabs (AI reply via WS); real SMS only if `TEST_TARGET_PHONE` set |
| `04-number-lifecycle.test.ts` | `twilio-assign-number` from pool, idempotency, voice URL + friendly_name, ElevenLabs registration | + Twilio |
| `05-integrations-toggle.test.ts` | `_shared/sms.ts` `resolveProvider` priority across every config shape | none |
| `06-vapi-call.test.ts` | Real outbound voice call, ElevenLabs agent first-turn transcript | + VAPI; skipped without `VAPI_API_KEY` + `TEST_TARGET_PHONE` |
| `07-multi-account.test.ts` | N parallel signups + provisioning, RLS isolation, vertical mix | + ElevenLabs |

## Tagging

Every resource is tagged with a per-run id of the form `e2e-pathir-<timestamp>-<rand>`. The `wipe` script finds anything starting with `e2e-pathir` and removes it, so a crashed run doesn't leave orphans.

## Cost

- Supabase: free
- ElevenLabs: each agent provisioned counts against the workspace agent limit; deleted in afterAll/wipe
- Twilio: assign-number tests pick **pooled** numbers (no purchase). VAPI test triggers one real call per run.
- TextMagic: real outbound SMS only if `TEST_TARGET_PHONE` is set

Expect well under £1 per full run unless `TEST_TARGET_PHONE` is set, in which case add ~5p per SMS sent.
