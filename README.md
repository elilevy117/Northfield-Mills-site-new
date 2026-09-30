# Northfield Mills website + team portal

Everything runs on **Netlify**:

| What | Netlify feature |
|---|---|
| The website | Netlify hosting (`public/`) |
| Email sign-ups, contact form, access requests | **Netlify Forms** |
| Team logins, password resets, invites | **Netlify Identity** |
| Tickets, team accounts, and copies of form submissions for the portal | **Netlify Database** (managed Postgres, powered by Neon) |
| Portal server code | Netlify Functions (`netlify/functions/`) |

```
public/                         the website (this is what visitors see)
  index.html                    whole site + team portal
  assets/                       images and logo
  _redirects, _headers          page addresses, security headers, caching
  404.html, robots.txt
netlify/functions/api.mjs       team portal API (checks every login and access level)
netlify/functions/submission-created.mjs
                                copies each verified form submission into the database
netlify/lib/form-sync.mjs       shared code that saves submissions and pulls them from Netlify Forms
netlify/database/migrations/    database tables (Netlify creates them on deploy)
package.json                    tells Netlify to use Netlify Database and Identity
netlify.toml                    Netlify settings
```

## Before you start
- **Plan:** Netlify Database needs a **credit-based Netlify plan**. It isn't on the legacy free plan, and an active database uses credits.
- **Deploy from GitHub or the Netlify CLI, not drag-and-drop.** Drag-and-drop skips the functions and the database.
- **Logins only work on the deployed site.** Netlify Identity doesn't run on your computer, so test on a real deploy.

## Setup (one time, about 20 minutes)

### 1. Put the site on Netlify
1. Create a GitHub repository and upload the **contents** of this folder, so `netlify.toml` sits at the top level.
2. In Netlify: **Add new project → Import an existing project → GitHub**, then pick the repository.
3. Leave the build command empty. `netlify.toml` already sets the publish folder to `public`.
4. Deploy. In the deploy log you should see Netlify set up the database and load the migration. Netlify creates the database and tables for you; there's nothing to run by hand.

### 2. Turn on Netlify Forms
1. **Project configuration → Forms → Enable form detection**, then redeploy once. Netlify then finds the three forms: `launch-list`, `contact`, and `account-request`.
2. **Let the portal read your form submissions.** In Netlify, open your avatar → **User settings → Applications → Personal access tokens → New access token.** Name it "Northfield portal", then copy it.
   Then open **Project configuration → Environment variables → Add a variable:** `NM_NETLIFY_API_TOKEN` = the token. Redeploy.
   The token stays on Netlify's servers and is never sent to visitors.
3. Optional: **Forms → Form notifications → Add notification → Email** to get sign-ups and messages at info@northfieldmills.com.

### 3. Turn on Netlify Identity
1. **Project configuration → Identity → Enable Identity.**
2. Under **Registration**, set **Invite only**. This matters: it stops strangers from creating logins. Employees request access through the form instead.

### 4. Make yourself the first admin
1. **Project configuration → Environment variables → Add a variable:**
   `NM_OWNER_EMAIL` = your email (for example `sam@northfieldmills.com`). Then redeploy.
2. **Identity → Users → Invite users →** enter that same email.
3. Open the invite email and click the link. The site asks you to **set your password**.
4. You're in the portal as **Admin**. This happens once: the owner email becomes admin only while no admin exists yet.

## Using the portal
- **Sign in:** "Team Sign In" in the site menu or footer, or go to `/login`. Anyone inactive for **10 minutes** is signed out automatically.
- **Create an account:** Portal → Accounts → **Create account**. Pick Staff or Admin and share the temporary password directly. They can change it under Accounts.
- **Access requests:** employees fill out **Request access** on the sign-in page. It arrives in Netlify Forms and in Portal → Accounts. **Approve** opens Create account pre-filled; **Decline** closes it.
- **Deactivate someone:** Portal → Accounts → **Deactivate.** They're blocked from the portal right away. To remove the login entirely, delete the user under Identity → Users.
- **Forgot password:** "Forgot password?" on the sign-in page emails a reset link.

| | Staff | Admin |
|---|---|---|
| Tickets and notes | ✓ | ✓ |
| Delete tickets | | ✓ |
| Inbox (contact form) | | ✓ |
| Email list and CSV export | | ✓ |
| Create, approve, and deactivate accounts | | ✓ |

## Where form submissions go
Every submission stays in **Netlify Forms** (the dashboard, with spam filtering and email alerts). The portal shows them from the database, which is filled two ways:
- **Instantly:** `submission-created` copies each new verified submission.
- **Whenever an admin opens the portal:** the portal pulls any submissions the database doesn't have yet from Netlify Forms, including everything submitted before the database existed. This needs `NM_NETLIFY_API_TOKEN` (step 2.2).

A submission is never stored twice. Each copy is tied to its Netlify submission ID.

## Changing the database later
Don't edit the migration file after it has run. Add a new `.sql` file with a later date in `netlify/database/migrations/`; Netlify applies it on the next deploy.
