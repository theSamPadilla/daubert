# Data Model

TypeORM entities with Postgres. `synchronize: true` in dev (auto-creates/updates tables). All entities extend `BaseEntity` (UUID PK + timestamps).

## Entity Hierarchy

```
User
CaseMember (join table: userId + caseId, unique constraint)
Case
├── CaseMember[]         (onDelete: CASCADE)
├── Investigation[]      (cascade: true)
│   ├── Trace[]          (cascade: true)
│   └── ScriptRun[]      (onDelete: CASCADE)
├── Production[]         (onDelete: CASCADE)
└── DataRoomConnection   (onDelete: CASCADE, 1:1 via unique caseId)

Conversation             (independent)
└── Message[]            (cascade: true)

LabeledEntity            (independent)
```

Deleting a case cascades through case members, investigations, traces, script runs, productions, and the data room connection. Conversations and labeled entities are independent.

## Base Entity

All entities inherit these fields:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Auto-generated primary key |
| `created_at` | timestamp | Auto-set on creation |
| `updated_at` | timestamp | Auto-updated on modification |

## Entities

### `users`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `email` | varchar | not null, unique |

**Relations**: One-to-many -> `case_members`

---

### `case_members`

| Column | Type | Constraints |
|--------|------|------------|
| `userId` | varchar | FK -> users |
| `caseId` | varchar | FK -> cases |
| `role` | varchar | default `'guest'` -- `'owner'` or `'guest'` |

**Unique constraint** on `(userId, caseId)`.

**Relations**:
- Many-to-one -> `users` (onDelete: CASCADE)
- Many-to-one -> `cases` (onDelete: CASCADE)

---

### `cases`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `start_date` | timestamp | nullable |
| `links` | jsonb | default `[]` |
| `user_id` | varchar | nullable, LEGACY -- new code uses `case_members` |

**Relations**:
- One-to-many -> `investigations` (cascade: true)
- One-to-many -> `case_members`
- One-to-many -> `productions`

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
- One-to-many -> `script_runs`

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

Stores the graph structure as JSONB:

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
  position: { x: number, y: number },
}
```

**WalletNode** fields: `id`, `label`, `address`, `chain`, `color`, `size`, `notes`, `tags[]`, `position`, `parentTrace`, `addressType`, `explorerUrl`, `groupId`

**TransactionEdge** fields: `id`, `from` (wallet ID), `to` (wallet ID), `txHash`, `chain`, `timestamp`, `amount`, `token`, `usdValue`, `color`, `label`, `notes`, `tags[]`, `blockNumber`, `crossTrace`

**Group** fields: `id`, `name`, `traceId`, `size`

**EdgeBundle** fields: `id`, `traceId`, `fromNodeId`, `toNodeId`, `token`, `collapsed`, `edgeIds[]`

The frontend expands `data` into typed `nodes`, `edges`, `groups`, and `edgeBundles` arrays. Auto-save serializes them back.

---

### `conversations`

| Column | Type | Constraints |
|--------|------|------------|
| `title` | varchar | nullable (auto-set after first message, truncated to 40 chars) |

**Relations**: One-to-many -> `messages` (cascade: true)

---

### `messages`

| Column | Type | Constraints |
|--------|------|------------|
| `conversation_id` | uuid | FK -> conversations, not null |
| `role` | enum | `'user'` or `'assistant'` |
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
| `investigation_id` | uuid | FK -> investigations, not null |

**Relations**: Many-to-one -> `investigations` (onDelete: CASCADE)

Created automatically when the AI agent uses the `execute_script` tool. Surfaced in the frontend sidebar under the Scripts section.

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
| `type` | varchar | `'report'`, `'chart'`, or `'chronology'` |
| `data` | jsonb | default `{}` |
| `case_id` | varchar | FK -> cases, not null |

**Relations**: Many-to-one -> `cases` (onDelete: CASCADE)

---

### `data_room_connections`

| Column | Type | Constraints |
|--------|------|------------|
| `case_id` | varchar | FK -> cases, UNIQUE (1:1 with case) |
| `provider` | varchar | default `'google_drive'` |
| `credentials_cipher` | bytea | AES-256-GCM encrypted OAuth credentials |
| `credentials_iv` | bytea | per-row IV |
| `credentials_auth_tag` | bytea | GCM auth tag |
| `folder_id` | varchar | nullable, Drive folder ID |
| `folder_name` | varchar | nullable, Drive folder display name |
| `status` | varchar | default `'active'` -- `'active'` or `'broken'` |

**Relations**: Many-to-one -> `cases` (onDelete: CASCADE)

## ER Diagram

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  users   │────<│ case_members │>────│    cases     │
│          │ 1:N │              │ N:1 │              │
│ name     │     │ userId (FK)  │     │ name         │
│ email    │     │ caseId (FK)  │     │ start_date   │
└──────────┘     │ role         │     │ links[]      │
                 └──────────────┘     │ user_id (LEG)│
                                      └──────┬───────┘
                          ┌───────────────────┼───────────────────┐
                          │ 1:N               │ 1:N               │ 1:1
                   ┌──────┴───────┐    ┌──────┴───────┐    ┌─────┴──────────────┐
                   │investigations│    │ productions  │    │data_room_connections│
                   │              │    │              │    │                     │
                   │ name         │    │ name         │    │ case_id (FK, UQ)    │
                   │ notes        │    │ type         │    │ provider            │
                   │ case_id (FK) │    │ data{}       │    │ credentials_cipher  │
                   └──────┬───────┘    │ case_id (FK) │    │ credentials_iv      │
                          │            └──────────────┘    │ credentials_auth_tag│
                   ┌──────┴──────┐                         │ folder_id           │
                   │ 1:N         │ 1:N                     │ folder_name         │
            ┌──────┴──────┐ ┌───┴──────────┐               │ status              │
            │  traces     │ │ script_runs  │               └─────────────────────┘
            │             │ │              │
            │ name        │ │ name         │
            │ data{}      │ │ code         │
            │ color       │ │ output       │
            │ visible     │ │ status       │
            │ collapsed   │ │ duration_ms  │
            │ inv_id (FK) │ │ inv_id (FK)  │
            └─────────────┘ └──────────────┘

┌───────────────┐     ┌──────────┐          ┌──────────────────┐
│ conversations │────<│ messages │          │ labeled_entities │
│               │ 1:N │          │          │                  │
│ title         │     │ role     │          │ name             │
│               │     │ content{}│          │ category         │
│               │     │ conv_id  │          │ description      │
└───────────────┘     └──────────┘          │ wallets[]        │
                                            │ metadata{}       │
                                            └──────────────────┘
```

## Frontend <-> Backend Mapping

The frontend uses different type names than the backend entities:

| Frontend Type | Backend Entity | Notes |
|--------------|---------------|-------|
| `Investigation` (types/) | `InvestigationEntity` | Frontend adds `description` (mapped from `notes`), `metadata`, and inline `traces[]` |
| `Trace` (types/) | `TraceEntity` | Frontend expands `data` JSONB into `nodes[]`, `edges[]`, `groups[]`, `edgeBundles[]`, `criteria`, `position` |
| `WalletNode` | -- | Stored inside `Trace.data.nodes[]` (no separate table) |
| `TransactionEdge` | -- | Stored inside `Trace.data.edges[]` (no separate table) |
| `Group` | -- | Stored inside `Trace.data.groups[]` (no separate table) |
| `EdgeBundle` | -- | Stored inside `Trace.data.edgeBundles[]` (no separate table) |
| `ScriptRun` (api-client) | `ScriptRunEntity` | 1:1 mapping |
| `Conversation` (api-client) | `ConversationEntity` | 1:1 mapping |
| `ChatMessage` (api-client) | `MessageEntity` | 1:1 mapping |
| `Production` (api-client) | `ProductionEntity` | 1:1 mapping |
| `DataRoomConnection` (api-client) | `DataRoomConnectionEntity` | Credentials stripped on read |
| `LabeledEntity` (api-client) | `LabeledEntityEntity` | 1:1 mapping |
| `CaseMember` (api-client) | `CaseMemberEntity` | 1:1 mapping |

Wallet nodes, transaction edges, groups, and edge bundles are **not** separate database tables -- they live inside the trace's `data` JSONB column. This keeps the graph structure atomic per trace and avoids complex join queries.
