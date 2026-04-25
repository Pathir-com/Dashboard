# Permission: instagram_business_basic

## How will your app use this permission?

When a dental practice connects their Instagram Business account to Pathir directly (without going through a Facebook Page), we need to read basic profile information about the Instagram account so we can confirm the right account was connected and display its name and username in the clinic dashboard.

The `instagram_business_basic` permission is Meta's required minimum for any read of Instagram Business profile metadata via the Instagram Login API. We use it once during the OAuth callback to fetch:
- The Instagram account's id
- Username
- Name (display name)
- Account type (BUSINESS or CREATOR)

This lets the dashboard show "Instagram connected: @spark_dental_clinic_uk (Spark Dental Clinic)" rather than just an opaque numeric account ID.

## Step-by-step reproduction

1. Go to https://app.pathir.com and log in with the Tester credentials in `tester-instructions.md`.
2. Open Settings → Integrations → Instagram DMs card.
3. Click "Connect with Instagram" (the gradient pink/orange button).
4. Complete the Instagram OAuth consent.
5. After redirect, the dashboard shows the IG username and account name in the Instagram card's "connected" state — that text is populated using `instagram_business_basic`.

## Data we collect via this permission

- Instagram account id, username, name, account_type
- Stored in the practice's `integrations` JSONB row in Supabase

## Why this is the minimum needed permission

`instagram_business_basic` is Meta's documented baseline scope for Instagram Login. Without it the OAuth response contains a token but no way to identify which account owns it. We do not request `instagram_business_manage_insights`, `instagram_business_content_publish`, or any other write/read scope for content — only the basic profile read.
