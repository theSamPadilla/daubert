# Data Room: Service Account Connection Mode

> **Status:** Idea capture — not ready to execute. Decision needed before implementation (see Open Questions).
> **For Claude:** This plan is intentionally high-level. Before executing, expand it into a task-by-task plan via `superpowers:writing-plans`.

**Goal:** Replace (or supplement) the per-user Google OAuth flow with a service-account-based Drive connection, eliminating the GCP verification / testing-mode allowlist constraint that currently blocks onboarding non-allowlisted users.

**Architecture:** A single Google Cloud service account is provisioned for the Daubert app. Each case owner shares one Drive folder with the service account's email (Editor permission) and pastes the folder ID into Daubert. The backend authenticates to the Drive API using the service account's JSON key — no OAuth redirect, no per-user refresh tokens, no consent screen.

**Tech Stack:** `googleapis` (already in use), Google service account JWT auth (replaces `OAuth2Client`), GCP IAM.

---

## Atomized Changes (UX and DX)

| # | File / Surface | Action | Purpose |
|---|---|---|---|
| 1 | `backend/src/modules/data-room/google-drive.service.ts` | Modify | Add service-account-based Drive client alongside (or replacing) the OAuth2 client. New auth path uses JWT, not refresh tokens. |
| 2 | `backend/src/modules/data-room/data-room.service.ts` | Modify | New `connectViaSharedFolder(caseId, folderId)` method: validates the bot has access, stores `folderId` against the case. Existing OAuth `getAuthUrl` / `handleCallback` either removed or kept as a second mode. |
| 3 | `backend/src/modules/data-room/data-room.controller.ts` | Modify | New endpoint `POST /cases/:caseId/data-room/connect-shared` accepting `{ folderId }`. OAuth endpoints removed or gated. |
| 4 | `backend/src/modules/data-room/encryption.service.ts` | Delete (or keep dormant) | If we drop OAuth entirely, no refresh tokens to encrypt → service unused. |
| 5 | Database — `case_data_room_connections` entity | Modify | Add `connection_mode` enum (`oauth` / `service_account`) and `folder_id`. Refresh-token columns become nullable (or dropped if we cut OAuth). |
| 6 | Migration | Create | Schema change for connection_mode + folder_id. |
| 7 | `frontend/src/app/cases/[caseId]/data-room/page.tsx` | Modify | Replace "Connect Google Drive" button with a guided two-step flow: (a) show the bot email + copy button, (b) input field for folder URL/ID, with validation. Keep the Picker view post-connection unchanged. |
| 8 | `frontend/src/lib/google-picker.ts` | Modify or delete | Picker currently uses the user's OAuth access token to render. In service-account mode there is no user token → Picker UI needs to be replaced with a simpler folder browser (or removed, since the bot only sees one folder anyway). |
| 9 | Env config — `backend/src/config/env.validation.ts` | Modify | Add `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON, base64-encoded). OAuth env vars become optional or removed. |
| 10 | `docs/` — connection-mode docs | Create | User-facing doc explaining the share-with-bot flow. Internal doc on rotating the service account key. |

**User-visible outcome:** Any Google user (not just allowlisted test accounts) can connect a Drive folder to a case in under a minute, without an OAuth consent screen and without Daubert holding any of their credentials.

**Developer-visible outcome:** No more GCP verification dependency. No refresh token rotation logic. One service account key to manage (stored in secret manager). The encryption service and OAuth callback handler can be deleted entirely if we commit to a single-mode rewrite.

---

## Why this exists

The current OAuth flow requires the `drive` scope, which is a Google "restricted scope." Restricted scopes trigger GCP's full verification process including a third-party CASA security assessment. Until verification completes, the app is stuck in Testing mode and can only be used by an allowlist of ~100 test users. This blocks any real customer onboarding.

The service account approach sidesteps OAuth entirely. Google does not consider "a user shared a folder with a service account email" to be an OAuth grant — it's just normal Drive sharing. No scopes to justify, no verification, no allowlist.

## Tradeoffs to surface before execution

- **Audit trail:** every file Daubert reads or writes will show the service account email in the user's Drive audit log, not the actual user's identity. For legal/investigation workflows where chain of custody matters, this is a real downside. Consider whether we need a defensible record of which Daubert user did what — that has to live in our own DB, not Drive's.
- **File ownership:** files Daubert creates in the shared folder will be owned by the service account. If we ever delete or rotate the service account, ownership transitions get messy. Mitigation: never delete the bot, only rotate keys.
- **UX feel:** sharing a folder with a `…iam.gserviceaccount.com` email feels weird to non-technical users. The first-run flow needs clear copy explaining what this is and why it's safe.
- **Migration:** existing cases already connected via OAuth — do they need to re-onboard via the new flow, or do we run both modes in parallel?

## Open Questions (decide before implementing)

1. **Replace OAuth or run both modes?** Cleaner to commit to service account only. Hybrid means double the surface area and double the bugs.
2. **What happens to the Picker integration?** Picker requires a user OAuth token. In service-account mode, we'd swap it for a simple folder listing UI (the bot only ever sees the one shared folder, so it's a smaller scope of files to browse).
3. **Is this a permanent solution or a stopgap?** If permanent, invest in good UX around the share-with-bot flow. If stopgap until OAuth verification completes, keep changes minimal and behind a feature flag.

## Rough phases (if we proceed)

1. **Decide direction** on the open questions above.
2. **Backend:** add service-account client, new connect endpoint, schema migration. Behind a feature flag if hybrid.
3. **Frontend:** new connect flow UI, folder ID input + validation, replace or simplify Picker.
4. **Provision** service account in GCP, store key in secret manager, document rotation.
5. **Test** end-to-end with a non-allowlisted Google account to confirm the GCP-testing-mode constraint is actually gone.
6. **Migrate** existing OAuth connections (or document a re-onboarding step).
7. **Delete** OAuth code paths and encryption service if going single-mode.

---

## Not in scope for this plan

- OAuth verification submission (the "right" long-term path — separate plan).
- Switching scope from `drive` to `drive.file` (alternative path that keeps OAuth — also a separate plan, and a prerequisite if we ever resubmit for verification).
- Any change to how Daubert *uses* Drive once connected (read/write file logic stays the same; only the auth layer changes).
