# Data Model

TypeORM entities with Postgres. `synchronize: true` in dev (auto-creates/updates tables). All entities extend `BaseEntity` (UUID PK + timestamps).

## Entity Hierarchy

```
User
└── Case                    (onDelete: CASCADE)
    └── Investigation       (cascade: true)
        ├── Trace           (cascade: true)
        └── ScriptRun       (onDelete: CASCADE)

Conversation                (independent)
└── Message                 (cascade: true)
```

Deleting a case cascades through investigations, traces, and script runs. Conversations are independent — not linked to cases.

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

**Relations**: One-to-many → `cases`

---

### `cases`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `start_date` | timestamp | nullable |
| `links` | jsonb | default `[]`, array of `{ url, label }` |
| `user_id` | uuid | FK → users, not null |

**Relations**:
- Many-to-one → `users` (onDelete: CASCADE)
- One-to-many → `investigations` (cascade: true)

---

### `investigations`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `notes` | text | nullable |
| `case_id` | uuid | FK → cases, not null |

**Relations**:
- Many-to-one → `cases` (onDelete: CASCADE)
- One-to-many → `traces` (cascade: true)
- One-to-many → `script_runs`

---

### `traces`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `color` | varchar | nullable |
| `visible` | boolean | default true |
| `collapsed` | boolean | default false |
| `data` | jsonb | default `{}` |
| `investigation_id` | uuid | FK → investigations, not null |

**Relations**: Many-to-one → `investigations` (onDelete: CASCADE)

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
  nodes: WalletNode[],    // wallet/address nodes
  edges: TransactionEdge[], // transaction edges
  position: { x: number, y: number },
}
```

**WalletNode** fields: `id`, `label`, `address`, `chain`, `color`, `notes`, `tags[]`, `position`, `parentTrace`, `addressType`, `explorerUrl`

**TransactionEdge** fields: `id`, `from` (wallet ID), `to` (wallet ID), `txHash`, `chain`, `timestamp`, `amount`, `token`, `usdValue`, `notes`, `tags[]`, `blockNumber`, `crossTrace`

The frontend expands `data` into typed `nodes` and `edges` arrays. Auto-save serializes them back.

---

### `conversations`

| Column | Type | Constraints |
|--------|------|------------|
| `title` | varchar | nullable (auto-set after first exchange) |

**Relations**: One-to-many → `messages` (cascade: true)

---

### `messages`

| Column | Type | Constraints |
|--------|------|------------|
| `conversation_id` | uuid | FK → conversations, not null |
| `role` | enum | `'user'` or `'assistant'` |
| `content` | jsonb | Anthropic ContentBlock[] verbatim |

**Relations**: Many-to-one → `conversations` (onDelete: CASCADE)

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

Compaction blocks (from the `compact-2026-01-12` beta) are also preserved verbatim — the SDK handles them transparently on reload.

---

### `script_runs`

| Column | Type | Constraints |
|--------|------|------------|
| `name` | varchar | not null |
| `code` | text | not null |
| `output` | text | nullable |
| `status` | varchar(20) | `'success'`, `'error'`, or `'timeout'`; default `'success'` |
| `duration_ms` | int | default 0 |
| `investigation_id` | uuid | FK → investigations, not null |

**Relations**: Many-to-one → `investigations` (onDelete: CASCADE)

Created automatically when the AI agent uses the `execute_script` tool. Surfaced in the frontend sidebar under the Scripts section.

## ER Diagram

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
│  users   │───<│    cases     │───<│investigations│───<│  traces  │
│          │ 1:N│              │ 1:N│              │ 1:N│          │
│ name     │    │ name         │    │ name         │    │ name     │
│ email    │    │ start_date   │    │ notes        │    │ data{}   │
│          │    │ links[]      │    │              │    │ visible  │
└──────────┘    │ user_id (FK) │    │ case_id (FK) │    │inv_id(FK)│
                └──────────────┘    └──────┬───────┘    └──────────┘
                                           │ 1:N
                                    ┌──────┴───────┐
                                    │ script_runs  │
                                    │              │
                                    │ name         │
                                    │ code         │
                                    │ output       │
                                    │ status       │
                                    │ duration_ms  │
                                    │ inv_id (FK)  │
                                    └──────────────┘

┌───────────────┐    ┌──────────┐
│ conversations │───<│ messages │
│               │ 1:N│          │
│ title         │    │ role     │
│               │    │ content{}│
│               │    │conv_id   │
└───────────────┘    └──────────┘
```

## Frontend ↔ Backend Mapping

The frontend uses different type names than the backend entities:

| Frontend Type | Backend Entity | Notes |
|--------------|---------------|-------|
| `Investigation` (types/) | `InvestigationEntity` | Frontend adds `description` (mapped from `notes`), `metadata`, and inline `traces[]` |
| `Trace` (types/) | `TraceEntity` | Frontend expands `data` JSONB into `nodes[]`, `edges[]`, `criteria`, `position` |
| `WalletNode` | — | Stored inside `Trace.data.nodes[]` (no separate table) |
| `TransactionEdge` | — | Stored inside `Trace.data.edges[]` (no separate table) |
| `ScriptRun` (api-client) | `ScriptRunEntity` | 1:1 mapping |
| `Conversation` (api-client) | `ConversationEntity` | 1:1 mapping |
| `ChatMessage` (api-client) | `MessageEntity` | 1:1 mapping |

Wallet nodes and transaction edges are **not** separate database tables — they live inside the trace's `data` JSONB column. This keeps the graph structure atomic per trace and avoids complex join queries.
