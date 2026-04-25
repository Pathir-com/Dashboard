# Tester instructions for Meta reviewers

Meta requires you to provide credentials and a step-by-step that lets the reviewer reproduce the integration end-to-end. Paste this content into the "Test instructions for reviewer" field in each App Review submission.

## Test environment

- **Pathir dashboard URL**: `https://app.pathir.com`
- **Test practice login**: 
  - Email: `<INSERT_TESTER_PRACTICE_EMAIL>`
  - Password: `<INSERT_TESTER_PRACTICE_PASSWORD>`
- **Test patient FB profile** (added as Tester on the Pathir Meta App):
  - Username: `<INSERT_TESTER_FB_USERNAME>`
  - Password: `<INSERT_TESTER_FB_PASSWORD>`
- **Test patient IG account** (added as Instagram Tester on the Pathir-IG Meta App):
  - Handle: `<INSERT_TESTER_IG_HANDLE>`
  - Password: `<INSERT_TESTER_IG_PASSWORD>`

> Replace the `<INSERT_*>` placeholders with real credentials for a clean tester account before submitting. **Do not use your personal credentials** — Meta reviewers will log in.

## Steps

### Facebook Messenger flow

1. Open `https://app.pathir.com`. Log in with the test practice login above.
2. Click Settings → Integrations.
3. Expand the **Facebook Messenger** card.
4. Click **"Connect with Facebook"**.
5. On Facebook's OAuth screen, log in with the **test patient FB profile**, then on the next screen, choose **Spark Dental Clinic** when asked which Page you want to manage. (The test patient profile administers Spark for review purposes.)
6. Grant all requested permissions: `pages_messaging`, `pages_manage_metadata`, `instagram_business_manage_messages`, `pages_show_list`.
7. You'll be redirected back to `https://app.pathir.com`. The Integrations tab will show a green "Connected: Spark Dental Clinic" state.
8. In a new tab, open `https://www.facebook.com/messages/`. Still logged in as the test patient FB profile, search for "Spark Dental Clinic", click Message, send: "Hi, I'd like to book a cleaning next week."
9. Within about 5 seconds, you'll see an AI reply ("Poppy") in your Messenger thread asking for a phone number.
10. Switch to the Pathir dashboard tab → Enquiries. The new conversation appears in the list with patient + clinic chat bubbles, channel "Facebook", and a recent timestamp.

### Instagram DM flow (Pathir-IG app)

1. Same dashboard. Expand the **Instagram DMs** card.
2. Click the gradient **"Connect with Instagram"** button.
3. Log in to Instagram with the **test patient IG account**.
4. Grant: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.
5. You'll be redirected back to `https://app.pathir.com`. The Instagram card shows "Instagram connected: @spark_dental_clinic_uk".
6. From the Instagram mobile app or `instagram.com`, still as the test patient IG account, send a DM to `@spark_dental_clinic_uk`: "Hi, what are your opening hours?"
7. Within ~5 seconds the AI assistant replies in your Instagram thread.
8. Pathir dashboard → Enquiries → confirm the conversation rendered with channel "Instagram".

## Disconnect flow (proves we honour deauthorisation)

1. In the Pathir dashboard, on either the Facebook or Instagram card, click "Disconnect".
2. Confirm in the toast.
3. Send another DM from the same patient account → no AI reply this time (we've removed our subscription and token).

## Data deletion

1. Email `admin2025@pathir.com` from the test patient address with subject "Data Deletion Request".
2. We confirm receipt within 2 working days and complete deletion within 30 days. (For review purposes you can simulate this by emailing during the review window; we'll respond on the next working day.)

## Notes for reviewer

- The dashboard is React + Vite hosted on GitHub Pages.
- Webhooks are Supabase Edge Functions in the EU (eu-west-1).
- AI replies come from ElevenLabs Conversational AI agents — one agent per practice, configured at signup with that practice's services, prices, hours, and tone.
- Cross-channel memory: if the same patient calls (voice), then DMs (Messenger), then texts (SMS), the AI recognises them by phone or social ID and remembers prior conversations. You can verify by sending a DM, then a follow-up SMS to the practice's connected number, both using the same patient credentials — the AI greets you by name on the second channel.
