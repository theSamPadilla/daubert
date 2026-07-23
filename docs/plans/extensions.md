# Extensions

Demand-gated add-ons that sit **behind the `StorageProvider` interface** introduced by the built-in data room (see [`../data-room.md`](../data-room.md)). None of these block launch; each is pulled forward only when the trigger condition is real.

## Bring-your-own-cloud providers

- [ ] **Google Drive provider** — new `StorageProvider` impl using the **`drive.file`** scope (non-restricted → **no CASA**) + Google **brand verification**; app owns a per-case data-room folder, file selection via Picker. Reuses the token-refresh/encryption/streaming machinery. **Trigger:** a customer requires files to stay in their own Google Workspace.
- [ ] **Microsoft OneDrive / SharePoint provider** — new impl via **Microsoft Graph + MSAL**, multi-tenant Azure AD (Entra) app, **verified publisher**. Requires the customer's **tenant admin consent** for the useful scopes (a regular user cannot self-onboard). **Trigger:** an enterprise SharePoint customer signs and their IT will grant consent.

## Import sources (copy external files INTO the built-in data room)

Distinct from the BYO-cloud providers above: here the external service is a one-time **source**, and the imported file lands in **our** GCS data room (its own `data_room_files` row + `upload` access-log entry). After import the file lives in our store independent of the source — *better* for chain-of-custody, since we capture a logged copy at import time.

- [x] **Import from Google Drive (`drive.file` + Picker)** (shipped to dev) — an "Add from Google Drive" action beside "Upload file". Flow: user opens the Google Picker (our OAuth client + a `NEXT_PUBLIC_DRIVE_PICKER_KEY`) and selects individual files; picking a file *through the Picker* grants the app `drive.file` access to exactly those files. The frontend passes the short-lived `drive.file` access token + picked file IDs to a new backend endpoint (e.g. `POST /cases/:caseId/data-room/import/google-drive`, `editor`+), which downloads each picked file from Drive and streams it straight into the existing `StorageProvider` (one `data_room_files` row + `upload` log per file).
  - **No full `drive` scope, no CASA** — `drive.file` is non-restricted.
  - **No stored credentials** — one-shot import uses the token in-request; no refresh token persisted, no encryption service.
  - **Still needs:** Google **brand verification** to leave testing mode (kills the ~100-test-user cap + "unverified app" screen — the *light* gate, not CASA); and re-introducing the Picker key + OAuth client on the frontend (both were removed when the OAuth data room was deleted).
  - **Trigger:** users want to pull case docs straight from their Drive instead of download-then-reupload. (A Microsoft/OneDrive equivalent via Graph + Picker is the natural sibling.)

## Storage hardening

- [ ] **CMEK (customer-managed encryption keys)** on the GCS bucket — for firms that require control of the encryption key. Default SSE covers MVP. **Trigger:** a security questionnaire mandates CMEK.
- [ ] **Direct signed-URL / edge serving** — bypass backend-brokered downloads for throughput. **Trigger:** download volume becomes a Cloud Run bottleneck *and* per-access audit logging can be relaxed (note: this trades away part of the custody story).
- [ ] **R2 backend option** — alternative `StorageProvider` impl. **Trigger:** GCS egress shows up as a real cost line (unlikely for a low-volume, upload-once/download-rarely legal data room).
