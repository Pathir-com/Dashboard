# Permission: instagram_business_manage_comments

## How will your app use this permission?

When a patient comments on the dental practice's Instagram post asking a question (for example "What are your opening hours?"), Pathir's AI assistant can hide spam, react to legitimate enquiries, and turn the comment into a private DM thread so the conversation continues in DMs rather than publicly under a post.

The `instagram_business_manage_comments` permission lets Pathir read incoming comments and reply to or hide them on behalf of the connected Instagram Business account. Combined with `instagram_business_manage_messages`, this gives the practice a complete way to respond to every patient enquiry whether it arrives as a DM or a comment.

## Step-by-step reproduction

1. Connect Spark Dental Clinic via "Connect with Instagram" as in `permission-instagram_business_basic.md`.
2. From a separate Tester Instagram account, comment on a post on Spark's profile: "What are your opening hours?".
3. The Pathir AI receives the comment via webhook, posts a public reply ("Thanks — DMing you the hours now"), and sends the actual hours via DM to the commenter.

## Data we collect via this permission

- Comment text and commenter Instagram-Scoped ID
- Post ID and timestamp
- Stored alongside other patient enquiries; same row-level security as DMs.

## Storage and retention

Same as Instagram DMs: stored in Supabase, deletable on request via https://app.pathir.com/data-deletion/.

## If you're not using comment auto-reply yet

If your initial App Review submission focuses on DMs only and you'd rather submit `instagram_business_manage_comments` later, you can omit it from the first round. The `instagram_business_basic` and `instagram_business_manage_messages` permissions alone deliver the core "AI replies to DMs" feature.
