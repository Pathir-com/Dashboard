# Data Use Checkup answers

Meta will ask for these inside the App Review submission flow. Have them ready.

## What categories of data does your app collect or process?

- **User Profile Information** — name, email address, phone number, when the patient provides them in conversation.
- **Messages and Communication** — full text of patient and AI messages across Messenger, Instagram, SMS, voice, and web chat.
- **Conversation metadata** — channel, timestamps, sender identifiers (PSID for Messenger, Instagram-Scoped ID for IG, phone number for SMS).
- **Appointment information** — service type, requested time slot, practitioner preference, when the patient books one.
- **Payment references** — Stripe payment intent IDs (no card data stored on Pathir; Stripe handles card data directly).

We do **not** collect: health records (the AI is configured not to ask for or persist medical history beyond what's volunteered in conversation), location data, advertising identifiers, ad-tracking metadata, biometric data.

## Why do you collect each category?

- **Profile info** — to identify returning patients across channels and to send appointment reminders by email or SMS.
- **Message text** — to provide an AI assistant that responds to patient enquiries and to give clinic staff a record of what was discussed.
- **Appointment info** — to book the patient into the practice's appointment system.
- **Payment refs** — to confirm payment for treatments where the practice charges deposits.

## Where is the data stored?

- **Primary store**: Supabase Postgres in the EU (region `eu-west-1`).
- **Row-level security** isolates each practice's data so practice A cannot read practice B's records.
- **Encryption at rest** via Supabase platform defaults.
- **Encryption in transit** TLS 1.2+ on every API call.

## Who can access the data?

- **Practice staff** — only their own practice's data, scoped by Supabase RLS based on their authenticated user id.
- **Pathir engineers** — service-role access for support, audited.
- **Sub-processors**:
  - ElevenLabs (AI reply generation) — message content sent to generate the reply, not retained beyond the request.
  - Twilio + TextMagic (SMS and voice carriage) — message content for delivery.
  - Meta (Facebook + Instagram) — message content for delivery.
  - Stripe (payments) — payment metadata only.
  - Resend / Gmail SMTP (email) — email content for delivery.

Each sub-processor has its own privacy policy and data-protection terms in place.

## How do users delete their data?

`https://app.pathir.com/data-deletion/` describes the process. Patients email `admin2025@pathir.com` with the subject "Data Deletion Request" and we erase their records within 30 days, as required by UK GDPR Article 12. Patients can also revoke our app via Facebook Settings → Apps and Websites; we receive Meta's deauthorisation callback and delete the linked identifiers.

## Are you a Tech Provider Solutions Provider (TPSP)?

Currently no. We may register as TPSP in future once we cross 100+ active clinics; until then we operate under Standard Developer terms.

## Children under 13?

No. Pathir is a B2B service for dental practices; patients interacting via Pathir's channels are presumed adult or accompanied. The Pathir dashboard requires staff authentication and is not directed at children.
