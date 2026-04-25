# Screencast script for Meta App Review

Total length: ~3 minutes per app. Two recordings (one Pathir, one Pathir-IG); the difference is which Connect button is clicked.

Tools you can use:
- Loom (loom.com) — free, easy
- QuickTime (Mac) → File → New Screen Recording
- OBS Studio
- Built-in Windows Game Bar (Win+G → Capture)

Resolution: at least 1280x720, mp4 preferred.

## Shot list — Pathir app (Facebook + linked Instagram)

### Shot 1 — Practice landing on the Pathir dashboard (~10 sec)

Open https://app.pathir.com → log in as Spark Dental Clinic admin → land on the dashboard. Cursor highlights:
- Practice name "Spark Dental Clinic" in the header
- A sample existing enquiry to show this is a live practice tool

### Shot 2 — Navigate to Integrations tab (~10 sec)

Click Settings (or the cogwheel) → Integrations tab → cursor lands on the Facebook Messenger card.

### Shot 3 — Click Connect with Facebook (~10 sec)

Expand the Facebook Messenger card → click "Connect with Facebook". Browser tab navigates to the Facebook OAuth consent screen.

### Shot 4 — Facebook OAuth consent (~25 sec)

Pause for 3 seconds on the consent dialog so the reviewer can see:
- App name: Pathir
- App icon
- Permissions being requested: `pages_messaging`, `pages_manage_metadata`, `instagram_business_manage_messages`, `pages_show_list`
- The clinic is asked to choose which Page (Spark Dental Clinic) and which IG (linked) to grant

Click "Continue" → "Save".

### Shot 5 — Return to dashboard, confirmation (~10 sec)

Browser redirects back to https://app.pathir.com/. Toast appears: "Facebook connected: Spark Dental Clinic + Instagram: @spark_dental_clinic_uk". The Facebook + Instagram cards both show the green "Connected" state.

### Shot 6 — Open Facebook Messenger as a test patient (~25 sec)

In a SEPARATE tab/browser/incognito, open https://www.facebook.com/messages/ logged in as the **Tester** account (the role-holder FB profile we use). Search for "Spark Dental Clinic", click Message, type "Hi, I'd like to book a cleaning next week" → send.

### Shot 7 — Show the AI reply landing in Messenger (~15 sec)

Within ~5 seconds, Poppy's reply appears in the same Messenger thread, naturally written, asking for the patient's phone number to look up their account.

### Shot 8 — Cut to Pathir dashboard (~15 sec)

Switch back to the Pathir dashboard tab. The Enquiries view shows the new conversation appearing in real time:
- Patient bubble: their original message
- Clinic bubble: Poppy's reply
- Channel label: Facebook
- Timestamps

### Shot 9 — Repeat for Instagram (~25 sec)

Switch to the Instagram app on a phone (or web at instagram.com), log into the Tester account, send a DM to @spark_dental_clinic_uk: "Hi, what are your opening hours?" → AI replies → switch back to Pathir dashboard, conversation appears under Instagram.

### Shot 10 — Wrap (~10 sec)

Cursor returns to the Integrations tab showing both Facebook and Instagram connected. End recording.

## Shot list — Pathir-IG app (Instagram-only)

Same as above except in Shot 3 you click the **gradient "Connect with Instagram"** button instead of "Connect via Facebook", and Shot 4 shows the Instagram OAuth consent screen instead of Facebook's. Skip Shot 6/7 (no Facebook Messenger test for this app).

## Tips for getting approved first time

- Do NOT use the same FB account that owns the app as the "patient" sender — Meta reviewers know admin-self-send is a Dev Mode artifact and may flag it. Use a **separate Tester FB account** for the patient role.
- Speak the actions out loud or use captions explaining each click. Reviewers are humans skimming dozens of submissions — make it easy.
- Show the patient's perspective AND the clinic's dashboard view, so reviewers see end-to-end value.
- If the reviewer can't reproduce, they reject. Make sure tester instructions in `tester-instructions.md` work as a cold-start.
