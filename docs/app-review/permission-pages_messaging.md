# Permission: pages_messaging

## How will your app use this permission?

Pathir is a SaaS platform that handles patient communication for dental practices. Each practice connects their Facebook Page through the Pathir clinic dashboard. Once connected, our service receives Messenger messages sent to the practice's Page via webhook, processes them through our AI assistant which answers questions about appointments, services, and prices, and sends replies back through the same Page on the practice's behalf.

The `pages_messaging` permission is the core requirement for this functionality: it lets Pathir send and receive Messenger messages on behalf of the connected Facebook Page. Without it, patients DMing the Page would receive no automated response and the practice would lose the engagement.

## Step-by-step reproduction

1. Go to https://app.pathir.com and log in with the Tester credentials in `tester-instructions.md`.
2. Open Settings → Integrations.
3. Expand the Facebook Messenger card.
4. Click "Connect with Facebook" — the Facebook OAuth dialog opens.
5. Choose the Spark Dental Clinic Page and grant the listed permissions.
6. The dashboard returns to the Integrations tab and shows "Facebook: connected to Spark Dental Clinic".
7. From a separate Facebook account (the Tester FB profile listed in `tester-instructions.md`), open Messenger, search for the Spark Dental Clinic Page, send the message: "Hi, I'd like to book a cleaning next week."
8. Within ~5 seconds, the AI assistant ("Poppy") replies in the same Messenger thread asking for the patient's phone number.
9. Switch to the Pathir dashboard tab. The new conversation appears under the Enquiries list with the patient message and Poppy's reply, both rendered as chat bubbles, with channel label "Facebook".

This proves the full inbound + outbound messaging loop using `pages_messaging`.

## Data we collect via this permission

- The text of inbound and outbound messages
- Sender PSID (Page-Scoped User ID) — used to identify returning patients across messages
- Message timestamp
- Page ID — used to route the message to the correct practice in our database

## Storage and retention

All messages are stored in the practice's row-level-security-isolated rows in Supabase (PostgreSQL hosted in eu-west-1). Practice staff can read their own practice's messages only. Pathir staff have service-role access for support and debugging. Patients can request deletion at https://app.pathir.com/data-deletion/ and we delete all stored messages within 30 days.

## Why testers can demo this without Advanced Access

In Standard Access (Development Mode), Meta delivers webhook events only for Page admins/developers/testers. We have provisioned the Spark Dental Clinic Page admin and a separate Tester FB profile so reviewers can complete the full flow.
