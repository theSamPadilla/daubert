# Drive Import — Operator Setup

What you must configure for the "Add from Google Drive" import to work. This is the **only** extra setup the feature needs — it's all OAuth-client / API / env config (no infra, no migration). The code uses the **`drive.file`** scope, so there's **no CASA** — only the light brand-verification gate.

The flow needs three things to line up in **one GCP project** (use `daubert-dev` for dev, the prod project for prod): an **OAuth web client**, the **Picker + Drive APIs enabled**, and two **frontend env vars**.

## 1. OAuth web client (reuse the existing one)

Don't make a new client — reuse the existing Daubert OAuth client (the one whose id was `GOOGLE_OAUTH_CLIENT_ID`). In **APIs & Services → Credentials → that OAuth 2.0 Client (Web)**:

- **Authorized JavaScript origins** — add every origin the app runs on:
  - `http://localhost:3001` (local dev)
  - `https://<your-prod-frontend-domain>` (Vercel prod)
- (No redirect URI needed — GIS token flow is popup-based, not a redirect.)

Then on **APIs & Services → OAuth consent screen**:
- Make sure the **`.../auth/drive.file`** scope is listed (add it under "Add scopes"). It's a **non-sensitive** scope — no CASA.

## 2. Enable the APIs

In the same project, **APIs & Services → Library**, enable:
- **Google Picker API**
- **Google Drive API**

## 3. Frontend env vars (Vercel + local)

Both are `NEXT_PUBLIC_*` (browser-exposed by design — they're not secrets):

| Var | Value | Where |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | the reused OAuth **web client id** (`…apps.googleusercontent.com`) | Vercel (prod) + `frontend/.env.development` (local) |
| `NEXT_PUBLIC_DRIVE_PICKER_KEY` | the browser API key for the Picker (already exists in dev) | Vercel (prod) + `frontend/.env.development` (local) |

- In `frontend/.env.development` the import code added a blank `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=` — fill it with the dev client id.
- Restrict `NEXT_PUBLIC_DRIVE_PICKER_KEY` in Cloud Console (Credentials → that API key) to the **Picker API + Drive API** and your app's **HTTP referrers** (domains).
- The **backend needs nothing** — it just receives the short-lived token and uses `googleapis` to fetch each file. No backend Google env vars.

## 4. Brand verification (to leave testing mode)

While the OAuth consent screen is in **Testing**, only ~100 allowlisted accounts can use the picker, and they see an "unverified app" screen. To open it to all users, submit **brand verification** (logo, homepage, privacy policy, domain ownership). Because the only scope is `drive.file` (non-sensitive), this is the **light** review — **no CASA, no annual pentest**. Until then, add real test users under **OAuth consent screen → Test users**.

## 5. Smoke test

Locally (or prod, once the above is set): open a case → **Data Room** → **Add from Google Drive** → complete the Google popup → pick a PDF and a Google Doc → both land in the file list (the Doc as `.docx`), each with an `upload` row in `data_room_access_log`. A Google **Form** should be reported as failed (unsupported), not silently dropped.

## Notes

- Dev and prod each need their own OAuth client config + env values (dev client lives in `daubert-dev`; prod client in the prod project).
- The token never leaves the request path — it's used in-memory by the backend to pull the picked files, then discarded. Nothing is stored.
