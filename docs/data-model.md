# Data Model

TypeORM entities with Postgres. `synchronize: true` in dev (auto-creates/updates tables). All entities extend `BaseEntity` (UUID PK + timestamps) except the four OAuth entities, which define their own primary keys (see their sections).

## Entity Hierarchy

```
User
├── OrganizationMember[]   (org-level role)
└── CaseMember[]           (case-level role)

Organization
├── OrganizationMember[]   (join: userId + organizationId, unique)
├── OrganizationInvite[]   (pending email invites with code)
├── Case[]                 (every case belongs to exactly one org)
├── Declarant[]            (org-scoped expert profiles; onDelete: CASCADE)
│   └── DeclarantFile[]    (cv / prior_declaration uploads; onDelete: CASCADE)
├── DeclarationLibraryBlock[]  (org-scoped reusable declaration content; CASCADE)
├── MonthlyUsage[]         (token metering rollup; onDelete: CASCADE)
└── OAuthSession[]         (MCP connect-grants; onDelete: RESTRICT, soft-revoked)

Case
├── CaseMember[]           (join: userId + caseId, unique; onDelete: CASCADE)
├── CaseInvite[]           (pending email invites with code; onDelete: CASCADE)
├── Investigation[]        (cascade: true)
│   └── Trace[]            (cascade: true)
├── ScriptRun[]            (case-scoped; optional investigation link, SET NULL)
├── Production[]           (onDelete: CASCADE)
├── Conversation[]         (per-user AI chats; onDelete: CASCADE)
│   └── Message[]          (cascade: true)
└── Data room              (data_room_folders + data_room_files + data_room_access_log;
                            scoped by caseId column, no FK relations)

Platform-level (no case/org FK):
LabeledEntity              (global wallet-label registry)
Otp                        (email OTP codes)
OAuthClient / OAuthCode / OAuthConsumedState   (OAuth 2.1 server state)
AgentAuditLog              (append-only MCP tool-call log; sessionId is not a FK)
TokenUsage                 (per-call metering; all parent links nullable SET NULL)
```

Deleting an organization cascades through its members, invites, cases (and everything beneath each case), declarants, declarant files, declaration library blocks, and monthly usage rows. Deleting a case cascades through case members, case invites, investigations, traces, script runs, productions, and conversations. Data room rows reference `case_id` by plain column (no FK), so the data-room service removes them explicitly. `oauth_session` rows are never deleted (RESTRICT + soft revocation) so `agent_audit_log` attribution survives. Labeled entities are independent.

The old `data_room_connections` table (per-case Google Drive OAuth link) is gone. It was replaced by the built-in data room (`data_room_files` / `data_room_folders` / `data_room_access_log`); see `docs/data-room.md`.

## Base Entity

All entities (except the OAuth four) inherit these fields:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Auto-generated primary key |
| `created_at` | timestamp | Auto-set on creation |
| `updated_at` | timestamp | Auto-updated on modification |

## Entities

### `users`

| Column | Type | Constraints |
|--------|------|------------|
| `firebase_uid` | varchar | nullable, unique |
| `name` | varchar | not null |
| `email` | varchar | not null, unique |
| `avatar_url` | varchar | nullable |
| `is_super_admin` | boolean | default `false` -- platform-wide superadmin flag |

**Relations**:
- One-to-many -> `organization_members`
- One-to-many -> `case_members`
- One-to-many -> `cases` (LEGACY relation via `cases.user_id`)

---

### `organizations`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `slug` | varchar | not null, unique |
| `deleted_at` | timestamptz | nullable -- soft delete (superadmin trash) |

**Relations**:
- One-to-many -> `organization_members` (cascade)
- One-to-many -> `cases`

---

### `organization_members`

| Column | Type | Constraints |
|--------|------|------------|
| `user_id` | uuid | FK -> users (onDelete: CASCADE) |
| `organization_id` | uuid | FK -> organizations (onDelete: CASCADE) |
| `role` | varchar | default `'guest'` -- `'admin'`, `'member'`, or `'guest'` |

**Unique constraint** on `(userId, organizationId)`.

Role semantics (see `docs/ROLES.md` for the full model):
- `admin` -- full org access, implicit owner of every case in the org
- `member` -- implicit editor on every case in the org; can create new cases
- `guest` -- sees org cases as ghosted tiles; needs an explicit `case_members` row to open one

---

### `organization_invites`

| Column | Type | Constraints |
|--------|------|------------|
| `organization_id` | uuid | FK -> organizations (onDelete: CASCADE) |
| `email` | varchar | indexed, lowercased |
| `role` | varchar | `'admin'`, `'member'`, or `'guest'` (admin invites are allowed; the old member/guest restriction was lifted) |
| `code` | varchar | not null, unique -- the invite token shared via URL |
| `message` | text | nullable -- optional note from the inviter |
| `created_by_user_id` | uuid | FK -> users |
| `expires_at` | timestamptz | not null |
| `used_at` | timestamptz | nullable -- set when redeemed |
| `used_by_user_id` | uuid | nullable, FK -> users -- who accepted |

---

### `case_members`

| Column | Type | Constraints |
|--------|------|------------|
| `user_id` | uuid | FK -> users (onDelete: CASCADE) |
| `case_id` | uuid | FK -> cases (onDelete: CASCADE) |
| `role` | varchar | default `'viewer'` -- `'owner'`, `'editor'`, or `'viewer'` |

**Unique constraint** on `(userId, caseId)`.

Role semantics:
- `owner` -- full control of the case, including membership management
- `editor` -- read + write graph data, productions, conversations
- `viewer` -- read-only

Org admins have implicit owner access and org members implicit editor access to every case in their org without an explicit `case_members` row (explicit rows win at the service layer; see `docs/ROLES.md`).

---

### `case_invites`

| Column | Type | Constraints |
|--------|------|------------|
| `case_id` | uuid | FK -> cases (onDelete: CASCADE) |
| `email` | varchar | indexed, lowercased |
| `role` | varchar | `'owner'`, `'editor'`, or `'viewer'` (owner invites are allowed) |
| `code` | varchar | not null, unique |
| `message` | text | nullable |
| `created_by_user_id` | uuid | FK -> users |
| `expires_at` | timestamptz | not null |
| `used_at` | timestamptz | nullable |
| `used_by_user_id` | uuid | nullable, FK -> users |

---

### `cases`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `summary` | text | nullable |
| `organization_id` | uuid | FK -> organizations, NOT NULL (every case belongs to an org) |
| `user_id` | uuid | nullable, LEGACY -- predates `case_members`, kept until phase 4 cleanup |

`summary` is free text, and it is also where the case onboarding wizard writes the optional engagement context when the summary is empty. The wizard builds a markdown block (`**Retained by:**` / `**Scope of engagement:**` / `**Key allegations:**`, see `frontend/src/components/Onboarding/engagementSummary.ts`) and PATCHes it onto the case only if no summary exists yet (never clobbers an existing one).

**Relations**:
- Many-to-one -> `organizations` (onDelete: CASCADE)
- One-to-many -> `investigations` (cascade: true)
- One-to-many -> `case_members` (cascade: true)
- One-to-many -> `case_invites` (cascade)
- One-to-many -> `productions` (cascade)
- One-to-many -> `script_runs`

---

### `investigations`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `notes` | text | nullable |
| `case_id` | uuid | FK -> cases, not null |

**Relations**:
- Many-to-one -> `cases` (onDelete: CASCADE)
- One-to-many -> `traces` (cascade: true)
- One-to-many -> `script_runs` (runs keep a nullable link; SET NULL on investigation delete)

---

### `traces`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `color` | varchar | nullable |
| `visible` | boolean | default true |
| `collapsed` | boolean | default false |
| `data` | jsonb | default `{}` |
| `investigation_id` | uuid | FK -> investigations, not null |

**Relations**: Many-to-one -> `investigations` (onDelete: CASCADE)

#### The `data` Column

Stores the graph structure as JSONB (canonical types in `frontend/src/types/investigation.ts`):

```typescript
{
  criteria: {
    type: 'time' | 'wallet-group' | 'custom',
    timeRange?: { start: string, end: string },
    wallets?: string[],
    description?: string,
  },
  nodes: WalletNode[],
  edges: TransactionEdge[],
  groups: Group[],
  edgeBundles: EdgeBundle[],
  labels: TraceLabel[],
  position: { x: number, y: number },
  hideTitle?: boolean,
}
```

**WalletNode** fields: `id`, `label`, `address`, `chain`, `color`, `size`, `shape`, `notes`, `tags[]`, `position`, `parentTrace`, `addressType`, `explorerUrl`, `groupId`

**TransactionEdge** fields: `id`, `from` (wallet ID), `to` (wallet ID), `txHash`, `chain`, `timestamp`, `amount`, `token` (object: `{ address, symbol, decimals }`), `usdValue`, `color`, `lineStyle`, `width`, `label`, `notes`, `tags[]`, `links[]`, `blockNumber`, `crossTrace`, `hasArc`, `arcOffset`

**Group** fields: `id`, `name`, `color`, `traceId`, `collapsed`, `size`

**EdgeBundle** fields: `id`, `traceId`, `fromNodeId`, `toNodeId`, `token` (symbol string), `collapsed`, `edgeIds[]`, `color`, `label`, `width`, `hasArc`, `arcOffset`

**TraceLabel** fields: `id`, `text`, `anchor` (free / node / edge / txEdge anchored), plus font size and shape styling

The frontend expands `data` into typed `nodes`, `edges`, `groups`, `edgeBundles`, and `labels` arrays. Auto-save serializes them back.

---

### `conversations`

| Column | Type | Constraints |
|--------|------|------------|
| `title` | varchar | nullable (auto-set after first message, truncated to 40 chars) |
| `case_id` | uuid | FK -> cases (onDelete: CASCADE), not null |
| `user_id` | uuid | FK -> users (onDelete: CASCADE), not null |

**Index** on `(case_id, user_id)`. Conversations are per-user within a case: each member sees only their own chats.

**Relations**: One-to-many -> `messages` (cascade: true)

---

### `messages`

| Column | Type | Constraints |
|--------|------|------------|
| `conversation_id` | uuid | FK -> conversations, not null |
| `role` | varchar | `'user'` or `'assistant'` |
| `content` | jsonb | Anthropic ContentBlock[] verbatim |

**Relations**: Many-to-one -> `conversations` (onDelete: CASCADE)

#### Content Format

The `content` column stores Anthropic's content block format directly:

```typescript
// User message
[{ type: 'text', text: 'What transactions...' }]

// Tool results (saved as user role)
[{ type: 'tool_result', tool_use_id: '...', content: '...' }]

// Assistant message (may contain multiple block types)
[
  { type: 'thinking', thinking: '...' },
  { type: 'text', text: 'Here are the results...' },
  { type: 'tool_use', id: '...', name: 'execute_script', input: { ... } },
]
```

Compaction blocks (from the `compact-2026-01-12` beta) are also preserved verbatim -- the SDK handles them transparently on reload.

---

### `script_runs`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `code` | text | not null |
| `output` | text | nullable |
| `status` | varchar(20) | `'success'`, `'error'`, or `'timeout'`; default `'success'` |
| `duration_ms` | int | default 0 |
| `case_id` | uuid | FK -> cases, not null (onDelete: CASCADE) |
| `investigation_id` | uuid | nullable, FK -> investigations (onDelete: SET NULL) |

**Relations**: Many-to-one -> `cases` (CASCADE); Many-to-one -> `investigations` (SET NULL)

Script runs are case-scoped; the investigation link is optional context that survives investigation deletion as NULL. Created automatically when the AI agent uses the `execute_script` tool. Surfaced in the frontend sidebar under the Scripts section.

---

### `labeled_entities`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `category` | varchar | `'exchange'`, `'mixer'`, `'bridge'`, `'protocol'`, `'individual'`, `'contract'`, `'government'`, `'custodian'`, or `'other'` |
| `description` | text | nullable |
| `wallets` | jsonb | default `[]`, array of wallet addresses |
| `metadata` | jsonb | nullable |

No relations. Independent entity.

---

### `productions`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `type` | varchar | `'report'`, `'chart'`, `'chronology'`, `'declaration'`, or `'redline'` |
| `data` | jsonb | default `{}` |
| `case_id` | uuid | FK -> cases, not null |

**Relations**: Many-to-one -> `cases` (onDelete: CASCADE)

#### The `data` Column per type

- **`report`** and **`chart`**: freeform (`Record<string, unknown>`), no backend schema.
- **`chronology`**: typed schema in `backend/src/modules/productions/chronology-schema.ts` (`entries[]` + configurable `columns[]` with text/link kinds).
- **`declaration`**: typed schema `DeclarationData` in `backend/src/modules/productions/declaration-data.ts`, not freeform:

```typescript
{
  schemaVersion: 1,
  formatId: 'ca-declaration' | 'ny-affirmation' | 'federal-1746'
          | 'tx-declaration' | 'fl-declaration',   // canonical; deprecated `variant` alias on old rows
  caption: { attorneyBlock, court, county, plaintiff, defendant,
             caseNumber, documentTitle, hearingInfo },
  declarantName: string,
  declarantDateOfBirth?: string,   // required only by formats that list it (e.g. TX)
  declarantAddress?: string,       // same
  sections: [{ id, kind, heading, paragraphs: [{ id, text, subItems[], exhibitIds[], footnotes[] }] }],
  exhibits: [{ id, label, description, source }],   // source: transaction | url | file | other
  execution: { place, date, signatureName },
}
```

Section `kind` is one of `qualifications`, `assignment`, `summary_of_opinions`, `background`, `authentication`, `findings`, `conclusions`, `recommendations`, `custom`. New declarations are seeded with six default sections; exhibit labels auto-assign A-Z then Z1, Z2, ...

- **`redline`**: typed schema `RedlineData` in `backend/src/modules/productions/redline-data.ts`, not freeform:

```typescript
{
  schemaVersion: 1,
  source: { fileId, fileName, mimeType, kind: 'docx' | 'pdf', extractedAt },
  baseText: string,   // immutable snapshot of the source document, seeded at creation
  edits: [{ id, kind: 'replace' | 'delete' | 'insert_after',
            anchor: { text, start, end }, newText, basis, comment?,
            status: 'proposed' | 'accepted' | 'rejected', origin: 'agent' | 'user' }],
  comments: [{ id, title, text }],
}
```

`baseText` is seeded once from the uploaded source file (`RedlineIngestService`, see `docs/redlining.md`) and is never overwritten afterward; a full `data` replace or a type change to/from `redline` both 400 at the service layer.

---

### `data_room_files`

| Column | Type | Constraints |
|--------|------|------------|
| `case_id` | uuid | indexed (plain column, no FK relation) |
| `name` | varchar | not null -- original filename |
| `mime_type` | varchar | not null |
| `size` | bigint | bytes (TypeORM surfaces as string) |
| `object_key` | varchar | not null, unique -- `org/<orgId>/case/<caseId>/<fileId>` |
| `uploaded_by_user_id` | varchar | not null |
| `folder_id` | varchar | nullable, indexed -- null means the file sits at the data room root |
| `anthropic_file_id` | varchar | nullable -- cached Anthropic Files API id, set the first time the AI agent reads an oversized PDF |

See `docs/data-room.md` for the storage architecture (GCS/local providers, streaming, chain of custody).

---

### `data_room_folders`

| Column | Type | Constraints |
|--------|------|------------|
| `case_id` | uuid | not null (plain column) |
| `parent_folder_id` | uuid | nullable -- self-reference by id, null means root |
| `name` | varchar | not null |
| `created_by_user_id` | varchar | not null |

**Index** on `(case_id, parent_folder_id)`. Folders are pure metadata; object keys stay flat.

---

### `data_room_access_log`

| Column | Type | Constraints |
|--------|------|------------|
| `case_id` | uuid | indexed (plain column) |
| `file_id` | varchar | nullable |
| `user_id` | varchar | not null |
| `action` | varchar | `'upload'`, `'download'`, `'delete'`, `'agent_read'`, or `'export'` |

Append-only chain-of-custody log. `agent_read` rows are written when the AI agent reads a data room file; `export` when files are pushed to Google Drive.

---

### `declarants`

Org-scoped expert profiles used to prefill declaration productions.

| Column | Type | Constraints |
|--------|------|------------|
| `display_name` | varchar | not null |
| `title` | varchar | nullable |
| `firm` | varchar | nullable |
| `qualifications` | jsonb | default `[]` -- array of freeform objects |
| `cv_exhibit` | varchar | nullable |
| `prior_testimony` | jsonb | default `[]` -- array of strings |
| `hourly_rate` | varchar | nullable |
| `non_contingency_disclosure` | text | nullable |
| `date_of_birth` | varchar | nullable (string, needed by e.g. the TX format) |
| `address` | text | nullable |
| `organization_id` | uuid | FK -> organizations (onDelete: CASCADE), not null |
| `user_id` | uuid | nullable, FK -> users (onDelete: SET NULL) -- optional link to a platform user; drives the self-ownership rule (a non-admin may only edit declarants linked to themselves) |

---

### `declarant_files`

| Column | Type | Constraints |
|--------|------|------------|
| `declarant_id` | uuid | FK -> declarants (onDelete: CASCADE), indexed |
| `kind` | varchar | `'cv'` or `'prior_declaration'` |
| `name` | varchar | not null |
| `mime_type` | varchar | not null |
| `size` | bigint | bytes (string in JS) |
| `object_key` | varchar | not null, unique -- `org/<orgId>/<fileId>` (flat org-scoped space, same storage provider as the data room) |
| `uploaded_by_user_id` | varchar | not null |

---

### `declaration_library_blocks`

Org-scoped reusable declaration content, shared across cases.

| Column | Type | Constraints |
|--------|------|------------|
| `kind` | varchar | `'declarant_profile'` or `'boilerplate'` |
| `name` | varchar | not null |
| `category` | varchar | nullable -- freeform grouping label |
| `content` | jsonb | default `{}` -- opaque block content (paragraph lists are normalized on write) |
| `organization_id` | uuid | FK -> organizations (onDelete: CASCADE), not null |

---

### `token_usage`

Per-call LLM metering. One row per API call.

| Column | Type | Constraints |
|--------|------|------------|
| `org_id` | uuid | nullable, FK -> organizations (SET NULL) |
| `user_id` | uuid | nullable, FK -> users (SET NULL) |
| `case_id` | uuid | nullable, FK -> cases (SET NULL) |
| `conversation_id` | uuid | nullable, FK -> conversations (SET NULL) |
| `message_id` | uuid | nullable, FK -> messages (SET NULL) |
| `surface` | varchar(32) | `'chat'`, `'title-generation'`, or `'declarant-extraction'` |
| `model` | varchar(128) | not null |
| `input_tokens` | int | default 0 |
| `output_tokens` | int | default 0 |
| `cache_read_input_tokens` | int | default 0 |
| `cache_creation_5m_input_tokens` | int | default 0 |
| `cache_creation_1h_input_tokens` | int | default 0 |

**Indexes** on `(org_id, created_at)`, `(user_id, created_at)`, `(case_id, created_at)`, `(conversation_id)`. All parent links are SET NULL so usage history survives deletions. Feeds the superadmin token-usage dashboards.

---

### `monthly_usage`

Monthly aggregate rollup of `token_usage`.

| Column | Type | Constraints |
|--------|------|------------|
| `org_id` | uuid | FK -> organizations (CASCADE), not null |
| `user_id` | uuid | FK -> users (CASCADE), not null |
| `period` | char(7) | `YYYY-MM` |
| `model` | varchar(128) | not null |
| `call_count` | bigint | default 0 |
| `input_tokens` | bigint | default 0 |
| `output_tokens` | bigint | default 0 |
| `cache_read_input_tokens` | bigint | default 0 |
| `cache_creation_5m_input_tokens` | bigint | default 0 |
| `cache_creation_1h_input_tokens` | bigint | default 0 |

**Unique constraint** on `(org_id, user_id, period, model)`. No per-surface breakdown at this granularity.

---

### `otps`

Email OTP codes for the email sign-in flow.

| Column | Type | Constraints |
|--------|------|------------|
| `email` | varchar | not null |
| `code` | varchar | not null |
| `expires_at` | timestamp | not null |
| `verified` | boolean | default false |

**Index** on `(email, verified)`. No relations.

---

### `oauth_client`

Registered MCP client applications for the OAuth 2.1 authorization server. PK is `client_id` (varchar 64), not a BaseEntity UUID.

| Column | Type | Constraints |
|--------|------|------------|
| `client_id` | varchar(64) | PRIMARY KEY -- opaque for dynamic clients, handle (e.g. `claude-desktop`) for pre-seeded |
| `display_name` | varchar(128) | shown on the consent screen |
| `redirect_uris` | text[] | exact-match allowlist |
| `is_public_client` | boolean | default true (all V1 clients are PKCE-only public clients) |
| `is_dynamic` | boolean | default false -- true for RFC 7591 dynamic registrations |
| `created_at`, `updated_at` | timestamp | |

---

### `oauth_code`

Short-lived authorization codes (60s TTL, single use). PK is `code` (SHA-256 hex of the raw code).

| Column | Type | Constraints |
|--------|------|------------|
| `code` | varchar(128) | PRIMARY KEY, hashed |
| `owner_user_id` | uuid | not null |
| `organization_id` | uuid | not null -- codes/sessions are bound to one (owner, org) pair; there is no scope column |
| `client_id` | varchar(64) | not null |
| `code_challenge` | varchar(128) | PKCE S256 challenge |
| `code_challenge_method` | varchar(16) | always `'S256'` (service-enforced) |
| `redirect_uri` | varchar(2048) | not null |
| `state` | varchar(512) | nullable |
| `expires_at` | timestamp | not null |
| `consumed_at` | timestamp | nullable -- set on token exchange |

---

### `oauth_consumed_state`

Replay cache for the signed consent state-bag. PK is `bag_id` (SHA-256 hex of the bag payload); a second consume attempt fails on PK collision. Rows expire 10 minutes after consumption and are purged by daily housekeeping.

| Column | Type | Constraints |
|--------|------|------------|
| `bag_id` | varchar(64) | PRIMARY KEY |
| `consumed_at` | timestamp | default `now()` |
| `expires_at` | timestamp | not null |

---

### `oauth_session`

One row per active MCP connect-grant (per device/surface). This is the durable "session" MCP calls ride on; there is no separate MCP session table.

| Column | Type | Constraints |
|--------|------|------------|
| `id` | uuid | PK |
| `owner_user_id` | uuid | FK -> users (onDelete: RESTRICT), not null |
| `organization_id` | uuid | FK -> organizations (onDelete: RESTRICT), not null -- every session is bound to exactly one org |
| `client_id` | varchar(64) | FK -> oauth_client (RESTRICT), not null |
| `surface_label` | varchar(255) | e.g. "Claude Desktop"; augmented from MCP clientInfo on first initialize |
| `access_token_hash` | varchar(64) | SHA-256 hex; raw token never persisted |
| `refresh_token_hash` | varchar(64) | SHA-256 hex; rotated on every refresh; reuse of an old token revokes the session |
| `access_token_expires_at` | timestamp | not null |
| `refresh_token_expires_at` | timestamp | sliding TTL |
| `last_used_at` | timestamp | nullable, write-damped on MCP calls |
| `created_at` | timestamp | auto |
| `revoked_at` | timestamp | nullable -- soft revocation only, rows are never deleted |
| `revoked_reason` | Postgres enum | `'user'`, `'admin'`, `'refresh_reuse'`, `'owner_deactivated'`, `'membership_revoked'` |

**Partial unique indexes** on `access_token_hash` and `refresh_token_hash` where `revoked_at IS NULL`; partial index on `(owner_user_id, organization_id)` for the "already connected?" query. Multiple live sessions per (user, client) are allowed (one per device).

---

### `agent_audit_log`

Append-only audit trail for actions performed by external agents via the OAuth-authenticated MCP server. One row per attempted tool call.

| Column | Type | Constraints |
|--------|------|------------|
| `session_id` | uuid | indexed; references `oauth_session.id` but deliberately NOT a FK (sessions are soft-revoked, never deleted) |
| `user_id` | uuid | not null |
| `organization_id` | uuid | not null |
| `action` | varchar(64) | e.g. `import_transactions`, `read_trace`, `list_cases` |
| `target_ref` | varchar(255) | nullable -- e.g. `trace:<uuid>` |
| `status` | varchar(16) | `'ok'` or `'error'` |
| `detail` | jsonb | nullable -- typed args, error message, counts |

Surfaced to users via `GET /me/agent-actions`.

## ER Diagram

Core org/case tree:

```
┌──────────┐    ┌─────────────────────┐    ┌──────────────┐
│  users   │───<│ organization_members│>───│organizations │
│ firebase │ 1:N│ userId, orgId, role │ N:1│ name, slug   │
│ name     │    └─────────────────────┘    │ deleted_at   │
│ email    │    ┌─────────────────────┐    │              │
│ avatar   │    │ organization_invites│>───│              │
│ super    │    │ email, role, code   │    └──────┬───────┘
└────┬─────┘    └─────────────────────┘           │ 1:N
     │ 1:N                                        v
┌────┴─────────┐                           ┌──────────────┐
│ case_members │>──────────────────────────│    cases     │
│ userId, caseId, role                     │ name         │
│  ('owner'/'editor'/'viewer')             │ summary      │
└──────────────┘                           │ org_id (FK)  │
┌──────────────┐                           │ user_id (LEG)│
│ case_invites │>─────────────────────────>│              │
│ email, role, code                        └──────┬───────┘
└──────────────┘                                  │
    ┌──────────────┬──────────────┬───────────────┼──────────────┬───────────────────┐
    │ 1:N          │ 1:N          │ 1:N           │ 1:N          │ (by caseId column)│
┌───┴──────────┐ ┌─┴────────────┐ ┌┴───────────┐ ┌┴────────────┐ ┌───────────────────┴┐
│investigations│ │ productions  │ │script_runs │ │conversations│ │ data room          │
│ name         │ │ name         │ │ name, code │ │ title       │ │ data_room_folders  │
│ notes        │ │ type (5)     │ │ output     │ │ case_id     │ │ data_room_files    │
│ case_id (FK) │ │ data{}       │ │ status     │ │ user_id     │ │ data_room_access_  │
└───┬──────────┘ │ case_id (FK) │ │ case_id FK │ └──────┬──────┘ │   log              │
    │ 1:N        └──────────────┘ │ inv_id (SN)│        │ 1:N    └────────────────────┘
┌───┴─────────┐                   └────────────┘ ┌──────┴───┐
│  traces     │                                  │ messages │
│ name, color │                                  │ role     │
│ data{}      │                                  │ content{}│
│ inv_id (FK) │                                  └──────────┘
└─────────────┘
```

Org-scoped declaration entities and metering:

```
┌──────────────┐ 1:N ┌────────────┐ 1:N ┌─────────────────┐
│organizations │────<│ declarants │────<│ declarant_files │
└──────┬───────┘     │ displayName│     │ kind (cv/prior) │
       │ 1:N         │ quals[]    │     │ object_key      │
       v             │ user_id?   │     └─────────────────┘
┌───────────────────────────┐
│ declaration_library_blocks│      ┌───────────────┐   ┌──────────────┐
│ kind, name, content{}     │      │ token_usage   │   │ monthly_usage│
└───────────────────────────┘      │ per-call rows │   │ per-month agg│
                                   │ org/user/case │   │ org + user + │
                                   │ /conv/msg (SN)│   │ period+model │
                                   └───────────────┘   └──────────────┘
```

Platform / OAuth / MCP:

```
┌──────────────┐  ┌────────────┐  ┌──────────────────────┐  ┌─────────────────┐
│ oauth_client │  │ oauth_code │  │ oauth_session        │  │ agent_audit_log │
│ PK client_id │  │ PK code    │  │ owner + org + client │──│ session_id      │
│ redirect[]   │  │ PKCE S256  │  │ token hashes         │  │ (no FK)         │
└──────────────┘  └────────────┘  │ soft revocation      │  └─────────────────┘
                                  └──────────────────────┘
┌──────────────────────┐  ┌──────────────────┐  ┌──────┐
│ oauth_consumed_state │  │ labeled_entities │  │ otps │
└──────────────────────┘  └──────────────────┘  └──────┘
```

## Frontend <-> Backend Mapping

The frontend uses different type names than the backend entities:

| Frontend Type | Backend Entity | Notes |
|--------------|---------------|-------|
| `Investigation` (types/) | `InvestigationEntity` | Frontend adds `description` (mapped from `notes`), `metadata`, and inline `traces[]` |
| `Trace` (types/) | `TraceEntity` | Frontend expands `data` JSONB into `nodes[]`, `edges[]`, `groups[]`, `edgeBundles[]`, `labels[]`, `criteria`, `position` |
| `WalletNode` | -- | Stored inside `Trace.data.nodes[]` (no separate table) |
| `TransactionEdge` | -- | Stored inside `Trace.data.edges[]` (no separate table) |
| `Group` | -- | Stored inside `Trace.data.groups[]` (no separate table) |
| `EdgeBundle` | -- | Stored inside `Trace.data.edgeBundles[]` (no separate table) |
| `TraceLabel` | -- | Stored inside `Trace.data.labels[]` (no separate table) |
| `ScriptRun` (api-client) | `ScriptRunEntity` | 1:1 mapping |
| `Conversation` (api-client) | `ConversationEntity` | 1:1 mapping |
| `ChatMessage` (api-client) | `MessageEntity` | 1:1 mapping |
| `Production` (api-client) | `ProductionEntity` | 1:1 mapping; `data` typed per production type |
| `DeclarationData` (generated) | -- | Typed JSONB inside `productions.data` for `type = 'declaration'` |
| `RedlineData` (generated) | -- | Typed JSONB inside `productions.data` for `type = 'redline'`; `baseText` immutable after creation |
| `DataRoomFile` / `DataRoomFolder` (api-client) | `DataRoomFileEntity` / `DataRoomFolderEntity` | 1:1 mapping |
| `Declarant` (generated) | `DeclarantEntity` | 1:1 mapping |
| `DeclarantFile` (api-client) | `DeclarantFileEntity` | 1:1 mapping |
| `DeclarationLibraryBlock` (api-client) | `DeclarationLibraryBlockEntity` | 1:1 mapping |
| `LabeledEntity` (api-client) | `LabeledEntityEntity` | 1:1 mapping |
| `CaseMember` (api-client) | `CaseMemberEntity` | 1:1 mapping |
| `CaseInvite` (api-client) | `CaseInviteEntity` | `code` only exposed to the inviter and the redeemer |
| `Organization` (api-client) | `OrganizationEntity` | 1:1 mapping |
| `OrganizationMember` (api-client) | `OrganizationMemberEntity` | 1:1 mapping |
| `OrganizationInvite` (api-client) | `OrganizationInviteEntity` | `code` only exposed to the inviter and the redeemer |

Wallet nodes, transaction edges, groups, edge bundles, and labels are **not** separate database tables -- they live inside the trace's `data` JSONB column. This keeps the graph structure atomic per trace and avoids complex join queries.
