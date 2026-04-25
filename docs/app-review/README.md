# Meta App Review submission package — Pathir

Two apps to submit:
- **Pathir** (App ID `1491843925659452`) — Facebook Messenger + Facebook-linked Instagram
- **Pathir-IG** (App ID `1537930541030559`) — direct Instagram Login API for clinics without a Facebook Page

Each app gets its own submission. Use the matching files in this folder.

## Order to submit

1. Read `screencast-script.md` and record the video for each app.
2. Read `data-use-checkup.md` and have the answers ready for Meta's questionnaire.
3. Read `tester-instructions.md` and have a working Spark Dental login ready for Meta reviewers.
4. For each permission file (`permission-*.md`), open the matching permission row in Meta's App Review UI, click "Get Advanced Access", paste the use-case description, upload the screencast, agree to terms, submit.

## Permission to submit per app

### Pathir app (Facebook + linked IG)

- `pages_messaging` — see `permission-pages_messaging.md`
- `pages_manage_metadata` — see `permission-pages_manage_metadata.md`
- `pages_show_list` — see `permission-pages_show_list.md`
- `instagram_business_manage_messages` — see `permission-instagram_business_manage_messages.md`

### Pathir-IG app (direct Instagram Login)

- `instagram_business_basic` — see `permission-instagram_business_basic.md`
- `instagram_business_manage_messages` — same content as Pathir, paste again
- `instagram_business_manage_comments` — see `permission-instagram_business_manage_comments.md`

## Direct submission URLs

- Pathir: https://developers.facebook.com/apps/1491843925659452/app-review/permissions/
- Pathir-IG: https://developers.facebook.com/apps/1537930541030559/app-review/permissions/

## Expected timeline

- Standard review: 3-7 business days
- If Meta asks follow-ups, response deadline is usually 7 days
- Approved permissions move from "Standard Access" (testers only) to "Advanced Access" (any user)

## Before clicking submit

Verify each of these is true:

- [ ] Privacy policy URL `https://app.pathir.com/privacy/` returns HTTP 200 with full content
- [ ] Terms URL `https://app.pathir.com/terms/` returns HTTP 200 with full content
- [ ] Data Deletion URL `https://app.pathir.com/data-deletion/` returns HTTP 200 with full content
- [ ] Both apps have a working Privacy URL filled in Settings → Basic
- [ ] Both apps have App Domain set
- [ ] You have a screencast recorded showing the OAuth + DM flow
- [ ] Spark Dental Clinic Page + IG account are reachable as test surfaces
- [ ] Tester credentials in `tester-instructions.md` work
