# Firebase OAuth: Cross-Site Sign-In Setup (Dev → Prod)

> **Operational runbook.** Code-side already done (`signInWithPopup` everywhere); this doc covers the per-environment Firebase / OAuth client config so login works in dev and prod.

## TL;DR — what you actually need to do for prod

1. Verify the prod app domain (`app.dauberts.ai`) is in **Firebase Authorized Domains** for the `daubert-prod` project.
2. Verify `https://daubert-prod.firebaseapp.com/__/auth/handler` is in:
   - Microsoft Entra prod app → Authentication → Web Redirect URIs.
   - Google OAuth client (GCP Console → APIs & Services → Credentials → "Web client (auto created by Google Service)") → Authorized redirect URIs.
3. Hit `app.dauberts.ai/login`, click Continue with Google / Continue with Microsoft, confirm sign-in completes.

That's the whole prod cutover for auth. **No DNS records, no SSL provisioning, no custom auth domain, no env var changes.** The code already uses popup mode, which sidesteps the cross-site issues that originally triggered this plan.

---

## Why this plan exists (and why it was almost wrong)

The original premise was: Chrome's **Third-party Storage Partitioning** (on by default since Chrome 115, July 2023) gives the cross-origin auth iframe an empty partitioned localStorage, so `getRedirectResult()` can't retrieve the OAuth tokens written during the redirect handler. Sign-in fails silently.

The proposed fix was to put Firebase auth on a subdomain of the app's registered domain (e.g., `auth.dauberts.ai` paired with `app.dauberts.ai`) so the two are same-site. This works for **prod** (subdomain of the same registered domain → same-site → no partitioning), but doesn't help **dev** because `localhost` can't be same-site with any public subdomain.

**The actual fix, which works for both dev and prod with no infrastructure changes, is `signInWithPopup` instead of `signInWithRedirect`.** Popup mode uses direct `postMessage` between the popup and the opener — no cross-origin iframe localStorage reads, no partitioning concerns. The whole storage-partitioning class of bugs goes away.

Code-side is already done in:
- `frontend/src/app/login/page.tsx` — main login.
- `frontend/src/app/org-invite/[code]/page.tsx` — invite acceptance flow.

So this plan is now mostly about verifying provider-side config (Firebase Authorized Domains + OAuth client allowlists), which is much simpler than custom auth domain setup.

---

## Verification checklist for each environment

### Dev (`localhost:3001` + `daubert-dev` Firebase project)

- [ ] Firebase Console → `daubert-dev` → Authentication → Settings → Authorized domains contains `localhost`.
- [ ] Google OAuth client (in the GCP project that maps to `daubert-dev`) → Authorized redirect URIs contains `https://daubert-dev.firebaseapp.com/__/auth/handler`. JavaScript origins contains `http://localhost:3001`.
- [ ] Microsoft Entra `Daubert AI (dev)` app → Authentication → Web Redirect URIs contains `https://daubert-dev.firebaseapp.com/__/auth/handler`.
- [ ] `frontend/.env.development` has `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=daubert-dev.firebaseapp.com` (default — no custom domain needed).
- [ ] `npm run fe` → click Google → popup completes → land on `/`. Repeat for Microsoft.

### Prod (`app.dauberts.ai` + `daubert-prod` Firebase project)

- [ ] Firebase Console → `daubert-prod` → Authentication → Settings → Authorized domains contains `app.dauberts.ai`.
- [ ] Google OAuth client (in the GCP project that maps to `daubert-prod`) → Authorized redirect URIs contains `https://daubert-prod.firebaseapp.com/__/auth/handler`. JavaScript origins contains `https://app.dauberts.ai`.
- [ ] Microsoft Entra `Daubert AI` (prod) app → Authentication → Web Redirect URIs contains `https://daubert-prod.firebaseapp.com/__/auth/handler`.
- [ ] Prod deploy env has `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=daubert-prod.firebaseapp.com`.
- [ ] Sign in to `app.dauberts.ai/login` with Google and Microsoft. Confirm both complete via popup and land on `/`.

If a step is missing, the failure mode tells you which:
- `auth/unauthorized-domain` → app domain missing from Firebase Authorized Domains.
- `redirect_uri_mismatch` → the auth handler URL isn't in the provider's OAuth client allowlist.
- Popup blocked → ask user to allow popups for the app domain.

---

## Gotchas with popup mode

- **Popups require a user gesture.** `signInWithPopup` must be called synchronously from a click handler. Don't fire it from a `useEffect`, a timer, or any async chain that crosses a microtask boundary before invocation — popup blockers reject it. (Already correctly wired in the login + invite handlers.)
- **`auth/popup-blocked`** is a real user-facing case. `friendlyAuthError` in `login/page.tsx` already maps it to a generic "sign-in cancelled" message; consider tightening that copy ("please allow popups for this site") if you see telemetry showing it's common.
- **Cross-Origin-Opener-Policy warnings** in the console (`window.closed call would be blocked` / `window.close call would be blocked`) are noise. Firebase polls the popup to detect closure; COOP blocks the read but Firebase falls back to `postMessage` and the auth still completes. Don't chase these.
- **AppCheck on Identity Toolkit.** If you ever enable AppCheck enforcement on the Firebase Auth API in the prod project, the client must initialize AppCheck (it does, gated on `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` in `frontend/src/lib/firebase.ts`). Make sure prod env has a real reCAPTCHA Enterprise site key, or leave AppCheck unenforced.

---

## Optional: branded auth URL (`auth.dauberts.ai`)

This is **purely cosmetic** — it changes the domain users briefly see in the URL bar during the popup OAuth flow from `daubert-prod.firebaseapp.com` to `auth.dauberts.ai`. It doesn't change reliability, and popup mode works fine with the default Firebase domain.

Only do this if you have a specific reason (branding, customer-facing trust, etc). The full steps:

1. Firebase Console → `daubert-prod` → Hosting → **Add custom domain** → `auth.dauberts.ai`.
2. Add the TXT (verification) + A records Firebase provides to your DNS provider for `dauberts.ai`. **Cloudflare gotcha:** if `dauberts.ai` is on Cloudflare, set the records to "DNS only" (gray cloud), not "Proxied" (orange cloud) — Cloudflare proxy strips Firebase's IPs and breaks the cert provisioning.
3. Wait for Firebase Hosting status to flip to "Connected" (~15–60 min for SSL cert provisioning, occasionally up to 24h).
4. In Microsoft Entra prod app → Web Redirect URIs → **add** (don't replace yet) `https://auth.dauberts.ai/__/auth/handler`. Keep the firebaseapp.com URI as a fallback during cutover.
5. In Google OAuth client → Authorized redirect URIs → add the same. Add `https://auth.dauberts.ai` to Authorized JavaScript origins.
6. In Firebase Console → Authentication → Settings → Authorized domains → add `auth.dauberts.ai`.
7. Update prod env: `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=auth.dauberts.ai`. Redeploy.
8. Test sign-in. If broken, switch the env var back; the firebaseapp.com fallback URIs you kept in step 4–5 mean nothing else has to change to roll back.
9. Once stable for a few days, remove the `daubert-prod.firebaseapp.com/__/auth/handler` URIs from Entra and Google OAuth.

For dev, skip this entirely — `localhost` can't share a registered domain with `auth-dev.dauberts.ai` anyway, so the branding benefit doesn't apply.

---

## What previous attempts at this plan tried (and why they failed)

For context if you find leftover infrastructure in dev:

- A custom auth domain `auth-dev.dauberts.ai` was provisioned on the `daubert-dev` Firebase Hosting site, with DNS pointing at `daubert-dev.web.app`. Google OAuth client was updated to include the corresponding redirect URI. `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` was switched to `auth-dev.dauberts.ai`. None of this fixed the underlying issue — `localhost:3001` is still cross-site with `auth-dev.dauberts.ai` (different registered domains), so the iframe storage partitioning that breaks `getRedirectResult` still applied.
- The actual fix turned out to be switching from `signInWithRedirect` to `signInWithPopup` (this commit). After that, the custom auth domain became unnecessary even in dev.
- The dev custom domain can be left in place (no harm) or torn down (DNS record + Firebase Hosting custom domain removal). The env var should be reverted to `daubert-dev.firebaseapp.com` to match the prod pattern, but `auth-dev.dauberts.ai` will also continue working since it's been added to Authorized Domains.

## Reference: Microsoft setup details

For the full Microsoft Entra app registration walkthrough (manifest quirks, secret rotation, publisher verification), see `docs/plans/2026-06-01-microsoft-login-setup.md`.
