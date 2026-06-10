# Built-in Data Room (GCS)

**One-liner:** Make a first-party, GCS-backed data room the default spine of every case — files just work with zero setup — and demote bring-your-own-cloud (Drive, OneDrive) to optional, deferred providers behind a storage-provider interface.

## Problem & why now

The current data room is a per-user Google OAuth integration using the **restricted `drive` scope**. That scope triggers Google's full verification path including a third-party **CASA security assessment** we don't have the bandwidth to complete. Until it's done, the app is stuck in Testing mode (≤100 allowlisted users) and **cannot onboard real customers**.

The interim idea was a service-account "share a folder with the bot" workaround. It has two fatal gaps:
- **(a)** Not every user has Google Drive, or knows/wants to share a folder with a `…iam.gserviceaccount.com` address.
- **(b)** There is no fallback if they don't.

And it carries a **chain-of-custody hole**: every read/write shows up in the user's Drive audit log as the bot, not the actual user — unacceptable for a tool literally named after the Daubert evidence-admissibility standard.

## Fit with strategy

- **Multi-tenant model (`docs/organizations.md`):** orgs own cases; storage is a tenant-level infrastructure concern, not a per-user choice made at first-run. A built-in default fits the invite-driven, org→case topology cleanly.
- **Evidence-grade product:** brokering every file access through the backend lets us write a per-user access log to our own DB — a *stronger* custody story than service-account Drive, not a weaker one.
- **`CLAUDE.md` — no short-term patches, recommend the complete solution:** the service-account flow is a patch around CASA. Built-in storage makes CASA *irrelevant* and removes a whole verification + maintenance surface from the launch path.

**The bet:** most customers don't care *where* files live as long as it's secure, fast, and zero-setup. The few who contractually require "evidence stays in our own Workspace" are a later, demand-gated add-on — not a launch blocker.

## The idea (refined)

1. **A first-party data room exists for every case automatically** — no connect step, no folder picker, no OAuth. Upload / list / download / delete, gated by `CaseMemberGuard`, available to members per existing role rules.
2. **Backend = Google Cloud Storage**, accessed from Cloud Run via **Workload Identity** in prod (no static keys) and ADC in dev.
3. **Every access is brokered through the backend** — no public objects, no long-lived presigned URLs. Each upload/download/delete writes an append-only **access-log row** (the custody record).
4. **Objects are scoped `org/<orgId>/case/<caseId>/<fileId>`.** A `data_room_files` table is the source of truth for what's in the room (name, size, mime, object key, uploader, timestamps); listing queries the table, not the bucket.
5. **All of this sits behind a `StorageProvider` interface** (`upload / list / download / delete / metadata`). GCS is the only implementation for MVP. Drive and Microsoft become additional implementations added later (see `docs/plans/extensions.md`).
6. **The current OAuth/`drive`-scope code is removed**, not revived. The OAuth callback, token encryption service, and Drive Picker go away. A future Drive integration is a *fresh* `drive.file`-based provider behind the interface — not the old restricted-scope code.

## Product decisions (locked — anchors for autonomous execution)

- **Built-in GCS is the default and the spine.** It is NOT a fallback. New cases get a working data room immediately.
- **Storage backend = GCS.** Chosen over R2 because: every access is backend-brokered for audit logging (which neutralizes R2's free-egress and edge-latency advantages), while GCS gives **no static credentials** (Workload Identity), a unified single-vendor sub-processor/compliance story, and clean data-residency answers — all of which matter to a legal-evidence buyer.
- **No bring-your-own-cloud in MVP.** Google Drive (`drive.file` + brand verification) and Microsoft (Graph + admin consent) are deferred to `docs/plans/extensions.md`, demand-gated.
- **Remove the existing OAuth Drive integration** (controller endpoints, `data-room.service` OAuth paths, `encryption.service.ts`, `google-picker.ts`, oauth-callback). Re-introduction later is a fresh provider, not a revival.
- **Access is always brokered through the backend.** No public buckets, no long-lived signed URLs. Per-access audit rows are mandatory.
- **Encryption at rest = GCS default SSE** for MVP. CMEK is a later, demand-gated extension.
- **Migrations follow `./migrations.sh` and are NOT applied by the implementer** — generate the file, leave it for the user to run (`CLAUDE.md` rule).
- **No commits unless explicitly requested** — work stays in the working tree for review (`CLAUDE.md` rule).

## Scope

**In (MVP):**
- `StorageProvider` interface + GCS implementation (Workload Identity prod / ADC dev).
- New data model: `data_room_files` (file metadata + object key + uploader) and `data_room_access_log` (append-only custody record). Migration generated via `./migrations.sh`.
- Reworked `data-room.service` + `data-room.controller`: upload (streaming, reuse busboy), list (from `data_room_files`), download (streaming via `StreamableFile`), delete — all backend-brokered and access-logged, gated by existing role rules.
- Removal of the OAuth connect flow, token encryption, oauth-callback, and Drive Picker.
- Frontend data room page: drop the connect/picker state machine; show a working file table + upload/download/delete from first load.
- Env/config: GCS bucket name + project; Workload Identity in prod, ADC in dev. OAuth env vars removed.
- Updated `docs/data-room.md` to describe the built-in model.

**Out / later (see `docs/plans/extensions.md`):**
- Google Drive provider (`drive.file` + brand verification).
- Microsoft OneDrive/SharePoint provider (Graph + MSAL + tenant admin consent).
- CMEK / customer-managed encryption keys.
- Direct signed-URL / edge serving (only if download volume explodes *and* per-access logging can be relaxed).
- An R2 backend (only if GCS egress ever becomes a real cost line).

## Risks & open questions

- **Weakest assumption:** that BYO-cloud demand is unvalidated/hypothetical. If a signed customer contractually requires files in their own Workspace, the Drive extension gets pulled forward — but it's still additive behind the interface, not a re-architecture.
- **Daubert becomes custodian.** Storing case files makes us the data custodian → we must get encryption-at-rest, backend-brokered access, the access log, and a clear deletion/retention story right. This is the core of the value, not a side concern.
- **Dev credentials (engineering detail):** prod uses Workload Identity; dev uses ADC (`gcloud auth application-default login`) against a dev bucket, or a GCS emulator. `/fullsend` picks the concrete dev path.
- **Migration of existing connected cases:** in practice the OAuth integration only ever worked for ≤100 allowlisted test users, so there is little/no real data to migrate. Treat existing `data_room_connections` rows as disposable; document a one-line note rather than building a migration path.
