# Permission: instagram_business_manage_messages

## How will your app use this permission?

Pathir is a SaaS platform that handles patient communication for dental practices. Many practices have an Instagram Business account where patients send DMs asking about services, prices, and appointments. Once a practice connects their Instagram via Pathir's "Connect with Instagram" or "Connect via Facebook" button, our service receives those Instagram DMs through Meta's webhook, processes them through our AI assistant, and sends replies back through the same Instagram account.

The `instagram_business_manage_messages` permission is the core requirement for this functionality: it lets Pathir read inbound Instagram DMs and send reply messages on behalf of the connected Instagram Business account. Without it, patients DMing on Instagram would receive no automated response.

## Step-by-step reproduction

1. Go to https://app.pathir.com and log in with the Tester credentials in `tester-instructions.md`.
2. Open Settings → Integrations.
3. Expand the Instagram DMs card.
4. Click either "Connect via Facebook" (if the IG is FB-Page-linked) or "Connect with Instagram" (direct).
5. Complete the OAuth consent for the Spark Dental Clinic Instagram account.
6. The dashboard returns to the Integrations tab and shows "Instagram connected: @spark_dental_clinic_uk".
7. From a separate Tester Instagram account, send a DM to @spark_dental_clinic_uk: "Hi, what are your opening hours?".
8. Within ~5 seconds, the AI assistant ("Poppy") replies in the same Instagram thread.
9. Switch to the Pathir dashboard. The new conversation appears with the patient message and reply, channel labelled "Instagram".

## Data we collect via this permission

- The text of inbound and outbound Instagram DMs
- Sender Instagram-Scoped ID — used to identify returning patients across messages
- Message timestamp
- Instagram Business Account ID — used to route the message to the correct practice

## Storage and retention

Same as Messenger: messages stored in row-level-security-isolated Supabase rows. Practice staff read their own only. Patients can request deletion at https://app.pathir.com/data-deletion/ and we delete within 30 days.

## Why testers can demo this without Advanced Access

In Standard Access, Meta delivers webhook events for IG accounts that have accepted the Instagram Tester invite. The Spark Dental Clinic IG account (`spark_dental_clinic_uk`) has accepted the invite. The reviewer's IG account also needs to be added as Tester for them to send a DM that triggers the webhook.
