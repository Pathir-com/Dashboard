# Permission: pages_show_list

## How will your app use this permission?

Some dental practices manage multiple Facebook Pages (for example, a multi-location practice with one Page per location). When the practice owner clicks "Connect with Facebook" on the Pathir dashboard, we need to show them a list of the Pages they administer so they can pick the correct one to connect to Pathir.

The `pages_show_list` permission lets our backend call `GET /me/accounts` after OAuth and present the practice owner with their Pages list inside the Pathir dashboard. Without it, we'd have to ask the user to manually type the numeric Page ID, which is hostile UX and rarely succeeds.

## Step-by-step reproduction

1. Set up a Tester Facebook account that administers more than one Page (for example, Spark Dental Clinic and a second mock Page).
2. Click "Connect with Facebook" on the Pathir dashboard.
3. Inside the OAuth consent dialog, Facebook itself uses `pages_show_list` to render the multi-Page picker. Pick Spark Dental Clinic.
4. After consent, the Pathir dashboard shows the chosen Page name in its connected state.

This is the standard "Choose which Page to grant" Facebook UI — `pages_show_list` is what enables it.

## Data we collect via this permission

- A list of Page names + IDs that the user administers
- Used only at OAuth time to render the picker; we discard the list after the user makes a choice and store only the chosen Page's ID + access token.

## Why testers can demo this without Advanced Access

Tester Facebook accounts that administer at least one Page can grant `pages_show_list` in Development Mode. The Tester profile in `tester-instructions.md` administers Spark Dental Clinic.
