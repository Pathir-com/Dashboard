# Permission: pages_manage_metadata

## How will your app use this permission?

When a dental practice connects their Facebook Page to Pathir via OAuth, our backend programmatically subscribes that Page to our webhook so that incoming Messenger messages are delivered to our server in real time. The `pages_manage_metadata` permission lets us call the Graph API endpoint `POST /{page-id}/subscribed_apps` to register the subscription, and the matching `DELETE` endpoint when the practice disconnects.

Without this permission, the connect flow would require the practice's staff to manually subscribe to webhook fields inside Facebook Business Suite, which is a complex multi-step process most clinic owners would never complete.

## Step-by-step reproduction

This permission is exercised silently as part of the same flow as `pages_messaging` (see `permission-pages_messaging.md`):
1. The practice clicks "Connect with Facebook" on the Pathir dashboard.
2. After OAuth consent, our backend exchanges the code for a Page Access Token and calls `POST /{page-id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks` using the new token.
3. Inbound Messenger DMs from that point onward are delivered to our `meta-webhook` Supabase Edge Function.
4. When the practice clicks Disconnect, we call the corresponding `DELETE` to unsubscribe.

The only user-visible effect is that Messenger DMs start (or stop) flowing into the Pathir dashboard's Enquiries list — there's no separate UI moment for this permission alone.

## Data we collect via this permission

None directly. The permission is used only for subscription management (registering and unregistering the webhook). It does not give Pathir access to Page metadata, posts, or any user data.

## Why this is the minimum needed permission

The narrower `pages_manage_engagement` permission would not be sufficient — it doesn't include webhook subscription management. `pages_manage_metadata` is Meta's documented minimum for `subscribed_apps`.
