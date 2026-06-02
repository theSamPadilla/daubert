# Microsoft Login Setup (Firebase + Entra ID)

> **Note:** Operational runbook, not a code-change plan. No Atomized Changes table — `microsoftProvider` is already wired into `frontend/src/lib/firebase.ts` and the login + invite pages already render a "Continue with Microsoft" button. This doc is the one-time external setup needed to make that button work, and the post-setup polish (terms/privacy links + publisher verification) needed to make the consent screen look professional.

> **Auth mode:** The frontend uses `signInWithPopup` (not redirect). All Microsoft OAuth happens in a popup window that posts the result back to the opener — no cross-site iframe storage, no custom auth domain needed. The redirect URI you'll register in Entra below is the Firebase auth handler URL Firebase uses inside that popup. Background and rationale: `docs/plans/2026-06-01-firebase-auth-domain-setup.md`.

> **Tenant restriction:** The Microsoft provider is configured with `tenant: 'organizations'` (see `frontend/src/lib/firebase.ts`), which accepts **work/school accounts only** (any Entra-backed tenant). Personal Microsoft accounts (hotmail/outlook/live/msn) are intentionally NOT supported. This is a B2B product, customers use org-issued Microsoft accounts. The `common` tenant — which would accept both personal and work/school — hangs the popup flow because Microsoft's account-type-detection interstitial severs `window.opener`, breaking the postMessage handshake Firebase relies on. Researched alternatives (BroadcastChannel, `same-origin-allow-popups`, redirect-mode-with-custom-auth-domain) either aren't viable in Firebase SDK as-shipped, don't fix the Microsoft-side issue, or require custom auth domain wiring we've opted out of. If you ever need to support personal accounts, the cleanest path is an email-domain detection flow (route `outlook.com`/`hotmail.com`/`live.com`/etc. to `tenant: 'consumers'`) — implementation is straightforward but adds UX complexity (modal or inline email field). Not in scope today.

> **Manifest tightening for prod (recommended):** Set `signInAudience: "AzureADMultipleOrgs"` on the prod Entra app — not the broader `AzureADandPersonalMicrosoftAccount` used in dev. Defense in depth: matches the client-side `tenant: 'organizations'` restriction so personal accounts get rejected server-side too. Dev can stay broader (it works because the client param restricts further), prod should be strict.

**Goal:** Enable "Sign in with Microsoft" on the login + invite pages, with a clean, verified consent screen that accepts both work/school AND personal Microsoft accounts.

**Total time:** ~30 min of active work for the working setup, plus ~1 week elapsed for publisher verification (mostly waiting on Microsoft).

**TL;DR sequencing:**
1. Create a personal Microsoft account using your Google-hosted email.
2. Sign up for Azure free tier (creates the Entra directory — required since Microsoft deprecated directory-less app registration in 2024). Credit card required for identity; no charges for Entra ID basic.
3. Register the app in Entra → set `signInAudience` + `requestedAccessTokenVersion` correctly so personal accounts work.
4. Wire client ID + secret into Firebase Console.
5. Add Authorized domains in Firebase.
6. (Polish) Fill in Branding URLs to remove the "publisher has not provided links" warning.
7. (Polish) Get a free Microsoft Partner ID + verify publisher to remove the "(Unverified)" badge.

There is **no app review, no fee, and no user cap** for the scopes we use (`User.Read` — basic profile + email). The Microsoft flow is dramatically simpler than Google's restricted-scope verification dance.

**Two registrations recommended (dev + prod):** standard OAuth hygiene. Each Firebase project gets its own Microsoft app with its own client secret. Lets you rotate prod secrets without breaking dev, and contains any dev-side compromise. Publisher verification (Part 7) is *per Entra tenant*, not per app — do it once and both registrations get the verified checkmark.

---

## Part 1: Create a Microsoft account (~5 min)

1. Go to **https://signup.live.com**.
2. Click "Use your email instead" and enter your Google-hosted address (e.g., `hello@bycrux.com`). Microsoft treats it as a personal Microsoft account — they don't care that the email is hosted on Google's MX. Set a Microsoft-side password.
3. Verify the email (Microsoft sends a code to that inbox, paste it back).
4. Done — you have a "personal Microsoft account" usable to log into the Azure / Entra portal.

## Part 2: Sign up for Azure (creates the Entra directory) (~10 min)

Microsoft removed the ability to register apps without an existing directory in 2024. Azure free-tier signup is the cleanest path — it auto-creates a directory and never charges as long as you only use the free Entra tier.

(Alternative: M365 Developer Program. Was the no-credit-card path, but now requires an existing qualifier — Visual Studio Enterprise/Pro subscription, MS Partner competency, etc. Skip unless you already qualify.)

1. Go to **https://azure.microsoft.com/free**.
2. Sign in with the personal Microsoft account from Part 1.
3. Walk through signup:
   - **Profile**: name, email (auto-filled), phone (real phone for SMS verification).
   - **Identity verification by card**: real credit/debit card. **$1 auth hold that drops off; no charge.** Used purely for identity verification.
   - Accept the customer agreement.
4. Done. You have an Azure subscription AND a default Entra directory (named `<yourname>.onmicrosoft.com`).

**What's free vs metered:**
- **Microsoft Entra ID Free**: included automatically. Up to 500,000 users, unlimited app registrations, OAuth flows. This is all we use.
- The "$200 free credit for 30 days" Azure offers on signup is for compute/storage — services we don't touch. After it expires, Entra stays free indefinitely.
- You only get charged if you spin up actual Azure VMs, storage accounts, etc. **Don't.** Close the Azure portal once Entra is reachable.

## Part 3: Register the app in Entra (~10 min per environment)

Repeat this whole part once for `Daubert AI (dev)` (paired with the dev Firebase project) and once for `Daubert AI` (paired with the prod Firebase project).

1. Sign in to **https://entra.microsoft.com** with the account from Part 1.
2. Confirm you see "Default Directory" (or your tenant name) in the top-right — that's the tenant the app will live in.
3. Left nav → **Applications** → **App registrations** → **+ New registration**.
4. Fill in:
   - **Name**: `Daubert AI (dev)` for the dev app, `Daubert AI` for prod.
   - **Supported account types**:
     - **Dev app**: select **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"** — broader audience kept around in case we ever need to test personal-account flows.
     - **Prod app (recommended)**: select **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)"** — work/school only. Matches our client-side `tenant: 'organizations'` policy. Personal accounts get rejected at Microsoft's end with a clean message instead of going through OAuth and failing.
   - **Redirect URI**: dropdown → **Web**, value: `https://<firebase-project-id>.firebaseapp.com/__/auth/handler`.
     - Find the project id in Firebase Console → Project Settings → General.
     - The `firebaseapp.com` URL is Firebase's hosted OAuth callback — Firebase handles the round-trip server-side.
5. Click **Register**.

**Copy the Application (client) ID** from the app's Overview tab. Save it for Part 4.

### Part 3a: Verify the manifest

Confirm the manifest values match the account-types choice you made in step 4.

1. Left nav of the app → **Manifest** (you may need to scroll).
2. Expected values:

   **Dev app:**
   ```json
   "signInAudience": "AzureADandPersonalMicrosoftAccount",
   "api": {
     ...
     "requestedAccessTokenVersion": 2,
     ...
   }
   ```

   **Prod app:**
   ```json
   "signInAudience": "AzureADMultipleOrgs",
   "api": {
     ...
     "requestedAccessTokenVersion": 2,
     ...
   }
   ```

3. If wrong, edit in the manifest JSON and **Save** at the top. The Authentication blade may refuse to flip `signInAudience` alone (it expects `requestedAccessTokenVersion` to change with it), but the manifest editor commits both atomically.

A working reference copy of the dev manifest is in `docs/scratch/misc.md`.

### Part 3b: Create a client secret

1. Left nav → **Certificates & secrets** → **+ New client secret**.
   - Description: `Firebase Dev` (or `Firebase Prod`).
   - Expires: pick **24 months** (longest non-custom option). Set a calendar reminder to rotate before expiry.
2. Click **Add**. **Copy the secret VALUE column IMMEDIATELY** — not the Secret ID, the long string in the "Value" column. It only shows once. If you lose it, delete and create a new one.

### Part 3c: Confirm API permissions

1. Left nav → **API permissions**.
2. Confirm `User.Read` (Delegated, Microsoft Graph) is listed. Added by default. No admin consent needed.
3. **Do NOT click "Grant admin consent for Default Directory"** — that only pre-consents for users *inside your own Entra directory*. Real users (customers in other directories or with personal accounts) self-consent on first sign-in, which is the correct model.

## Part 4: Wire into Firebase (~3 min per environment)

Repeat once for each Firebase project (dev → dev Microsoft app, prod → prod Microsoft app).

1. Firebase Console → your project → **Authentication** → **Sign-in method**.
2. Click **Add new provider** → **Microsoft**.
3. Paste:
   - **Application (client) ID** (from Part 3 step 5).
   - **Application secret** (the VALUE from Part 3b step 2).
4. Save. **Copy the redirect URI Firebase displays** at the bottom of the dialog (`https://<project-id>.firebaseapp.com/__/auth/handler`).
5. Back in Entra → your app → **Authentication** → confirm that same URL is in the Web Redirect URIs list. Paranoia check — should match what you set in Part 3 step 4.

## Part 5: Authorized domains (~30 sec)

Firebase Console → **Authentication → Settings → Authorized domains**. Confirm `localhost` (for dev), and your prod domain (e.g. `app.dauberts.ai`) are listed. Add any missing. Firebase needs these to allow the popup to talk back.

## Part 6: Branding — fix the "no terms or privacy links" warning (~2 min)

Without this, the consent screen shows "The publisher has not provided links to their terms for you to review at https://microsoft.com/consent." Looks unprofessional.

1. Entra → your app → **Branding & properties**.
2. Fill in:
   - **Home page URL**: `https://app.dauberts.ai` (or whatever your domain is)
   - **Terms of service URL**: `https://dauberts.ai/terms` (Microsoft only checks the URL is reachable, not its content)
   - **Privacy statement URL**: `https://dauberts.ai/privacy`
   - **Logo**: upload PNG, square, at least 215×215. Use the Daubert mark on a transparent or branded background.
3. Save.

Refresh the consent screen. The warning disappears and your logo + name display properly.

The "(unverified)" badge stays until Part 7. Do that next if you have the time, or after launch.

## Part 7: Publisher verification — remove the "(unverified)" badge (~30 min active, ~1 day Microsoft approval)

Done **once per Entra tenant**, not per app. Both your dev and prod registrations get verified at the same time.

### Step 1 — Get a free Microsoft Partner ID (~10 min)

1. Go to **https://partner.microsoft.com/dashboard/v1/enrollment/welcome**.
2. Sign in with the same Microsoft account.
3. Fill in business info: legal entity name (e.g., Incite Ventures LLC), business address, phone. Use your actual registered business entity — Microsoft cross-checks this.
4. Microsoft assigns a **Partner ID** (formerly MPN ID). Sometimes instant, sometimes a few hours. No fee.

### Step 2 — Verify your domain in Entra (~30 min, mostly DNS propagation)

This proves you control the domain you'll associate with the app.

1. Entra → top-right gear → **Settings** → **Domain names** → **+ Add custom domain**.
2. Enter `dauberts.ai` (whatever production domain you want associated).
3. Microsoft gives you a TXT record value (long `MS=...` string).
4. Add to your DNS provider:
   - Type: `TXT`
   - Host: `@` (root) or as Microsoft specifies
   - Value: the `MS=...` string
5. Save the DNS change. Wait 5–30 min for propagation.
6. Back in Entra → click **Verify** on the domain. Should flip to "Verified."

### Step 3 — Apply publisher verification (~5 min, ~1 day approval)

1. Entra → your app → **Branding & properties**.
2. Scroll to **Publisher domain** → change to the verified custom domain from Step 2 (e.g., `dauberts.ai`).
3. Find the **Add MPN ID to verify publisher** link / section.
4. Paste the Partner ID from Step 1.
5. Click **Verify and save**.
6. Repeat for the other app (dev / prod) — same MPN ID, same domain. Both verify simultaneously.

Microsoft auto-approves usually within 24 hours (often within minutes). When it goes through, the consent screen replaces "(unverified)" with a verified checkmark and shows your business name as the publisher.

## Part 8: Test

Reload `localhost:3001/login` (dev) or your prod URL, click **Continue with Microsoft**. You should see a Microsoft popup. First sign-in:

1. Prompts for Microsoft credentials (work, school, or personal — any account type).
2. Shows the consent screen — with your logo, Verified badge, real Terms/Privacy links, and the `Read your profile` (User.Read) scope.
3. On accept, popup closes, frontend gets a Firebase ID token, backend's `AuthGuard` matches by email and links the Firebase UID — same flow as Google.

---

## What the polished consent screen looks like

Once Parts 6 + 7 are complete:

- Your app logo at top.
- "Daubert AI needs your permission to:"
- **Verified** checkmark next to publisher name (e.g., "Incite Ventures LLC").
- Working links to Terms of Service / Privacy Statement.
- `Read your profile` (User.Read) scope.

## Publishing / review status

For the `User.Read` scope:

| Concern | Reality |
|---|---|
| App review before going live | None. App is live immediately after registration. |
| User cap | None. Unlimited from day one. |
| Third-party security assessment | None for `User.Read`. The "Microsoft 365 Certification" program exists but is only relevant for enterprise marketplace listings. |
| Recurring annual fee | None. |
| Publisher verification | Optional (Part 7). Just removes the "(Unverified)" badge — sign-in works without it. |
| Admin consent | Not needed. End users self-consent. |

## When you'd hit actual friction

- Requesting **admin-only scopes** (e.g., cross-tenant calendar reads). Not what we do.
- Applying for **Microsoft 365 Certification** to list on the Marketplace (~$0–$5k, 4–8 weeks). Unnecessary unless enterprise procurement demands it.
- Getting user-reported / flagged by Microsoft's risk engine. Remedy is responding to a security email.

## Tenant admin policies (the only real-world gotcha)

If a customer's IT admin has strict Entra policies — "block non-verified-publisher apps" or "require admin consent for everything" — the app won't work for their users until they explicitly allow it. Rare for SMBs / law firms. Common at Fortune 500. Publisher verification (Part 7) defuses most cases.

---

## Gotchas to remember

- **`signInAudience` + `requestedAccessTokenVersion`**: dev is `AzureADandPersonalMicrosoftAccount`, prod is `AzureADMultipleOrgs`, both pair with `requestedAccessTokenVersion: 2`. The Authentication blade won't let you flip one without the other — edit both in the Manifest in a single save.
- **Email shape**: Microsoft accounts can have an email hosted by Google (like the one you used in Part 1). Firebase uses whatever email Microsoft returns in the ID token — usually the `preferred_username` claim. Backend's `findByEmail` already lowercases on read, so case differences are fine.
- **Secret rotation**: 24-month expiry. Set a calendar reminder ~1 month before. Rotation: create a new secret in Entra → paste into Firebase Console → delete the old one. Zero downtime.
- **Publisher verification scope**: tenant-wide. One verification covers all apps in the tenant — including future ones.
- **No code changes needed**: provider is already wired in `frontend/src/lib/firebase.ts`. Firebase reads provider config from the console at runtime. As soon as Part 4 step 4 saves, the button starts working in that environment. No deploy.
- **Domain verification consequence**: once you verify `dauberts.ai` in Entra, your `<tenant>.onmicrosoft.com` default domain stays alive, but `dauberts.ai` becomes available as the "publisher domain" displayed on the consent screen. Cosmetic only — no email routing / MX changes.

## Comparison to Google

Why Microsoft is the lighter path:

- **Google + restricted scopes (Drive, Gmail)**: CASA tier 2/3, $10–25k, 6–12 weeks, annual reassessment. (See `docs/scratch/misc.md`.)
- **Google + non-restricted scopes (OpenID/email/profile only)**: branded consent screen verification, free, ~2–7 days, no user cap once verified.
- **Microsoft + `User.Read`**: nothing required. Optional publisher verification (Part 7) is the cosmetic upgrade.
