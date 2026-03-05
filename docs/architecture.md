# Architecture

Daubert is a blockchain transaction investigation tool. Monorepo with a Next.js frontend, NestJS backend, and OpenAPI contracts.

## Repository Layout

```
daubert/
├── frontend/          Next.js 14 (App Router), Tailwind, Cytoscape.js
├── backend/           NestJS, TypeORM, Postgres
├── contracts/         OpenAPI YAML (paths/, schemas/)
└── docs/              This documentation
```

## Run Commands

| Command | What it does |
|---------|-------------|
| `npm run db` | Start Postgres 16 container on port 5433 |
| `npm run be` | NestJS dev server on port 8081 |
| `npm run fe` | Next.js dev server on port 3001 |
| `npm run gen` | Generate `api-types.ts` in both frontend and backend from OpenAPI |

## Environment Variables

| Variable | Required | Used by |
|----------|----------|---------|
| `DATABASE_URL` | No (SQLite fallback) | Backend — Postgres connection |
| `ANTHROPIC_API_KEY` | Yes | Backend — Claude API (agent chat) |
| `ETHERSCAN_API_KEY` | No | Backend + AI scripts — Etherscan V2 |
| `TRONSCAN_API_KEY` | No | Backend + AI scripts — Tronscan / TronGrid |
| `NEXT_PUBLIC_API_URL` | No (defaults to `http://localhost:8081`) | Frontend — backend base URL |

## Backend

NestJS app on port 8081. CORS enabled. Global `ValidationPipe` with whitelist + transform.

### Module Map

| Module | Responsibility |
|--------|---------------|
| `UsersModule` | User entity CRUD |
| `CasesModule` | Case CRUD (belongs to user) |
| `InvestigationsModule` | Investigation CRUD + script run listing |
| `TracesModule` | Trace CRUD (graph data as JSONB) |
| `BlockchainModule` | Multi-chain transaction fetching via provider pattern |
| `AiModule` | Agentic AI chat, LLM provider, tool dispatch, script execution |

### Endpoint Overview

```
GET    /health

GET    /users/me

GET    /cases
POST   /cases
GET    /cases/:id
PATCH  /cases/:id
DELETE /cases/:id

GET    /cases/:caseId/investigations
POST   /cases/:caseId/investigations
GET    /investigations/:id
PATCH  /investigations/:id
DELETE /investigations/:id
GET    /investigations/:id/script-runs

GET    /investigations/:invId/traces
POST   /investigations/:invId/traces
GET    /traces/:id
PATCH  /traces/:id
DELETE /traces/:id
POST   /traces/:id/import-transactions

POST   /blockchain/fetch-history
POST   /blockchain/get-transaction

POST   /conversations
GET    /conversations
GET    /conversations/:id/messages
POST   /conversations/:id/chat          (SSE stream)
```

## Frontend

Next.js 14 with App Router. Single-page investigation workspace at `/`.

### Layout

```
┌──────────┬────────────────────────────────┬──────────────┐
│          │                                │              │
│ Sidebar  │     Graph Canvas (Cytoscape)   │   AI Chat    │
│ (w-60)   │                                │   (w-96)     │
│          │  ┌──────────────────────────┐  │              │
│ Cases    │  │ Details Panel (floating) │  │ Conversations│
│ Traces   │  └──────────────────────────┘  │ Messages     │
│ Scripts  │  ┌──────────────────────────┐  │              │
│          │  │ Staging Panel (floating) │  │              │
│          │  └──────────────────────────┘  │              │
└──────────┴────────────────────────────────┴──────────────┘
```

### Key Patterns

**State management** — `useInvestigation` hook (useReducer) owns all graph state. 13 actions for trace/wallet/transaction CRUD.

**Auto-save** — 1-second debounce after any state change persists all traces to the backend.

**Graph rendering** — Cytoscape.js with incremental sync in `useCytoscape`. Traces map to compound nodes, wallets to nodes, transactions to edges.

**API client** — Typed fetch wrapper in `src/lib/api-client.ts`. AI chat uses raw fetch with SSE event streaming.

**Selected item** — `selectedItem` state drives the floating details panel. Types: `wallet`, `transaction`, `trace`, `scriptRun`.

### Component Map

| Component | Purpose |
|-----------|---------|
| `Sidebar` | Case/investigation tree + traces list + scripts list |
| `Header` | Investigation name, "Add Address" / "Add Transaction" buttons |
| `GraphCanvas` | Cytoscape wrapper |
| `DetailsPanel` | Floating panel for selected item details (view + edit modes) |
| `StagingPanel` | Bulk-add fetched transactions to a trace |
| `AIChat` | Chat panel with conversation history, SSE streaming |
| `ScriptsPanel` | Script run list in sidebar (status dot + name + time ago) |
| `WalletForm` / `TransactionForm` / `TraceForm` | Create/edit modals |
| `LinkInputModal` | Parse block explorer URLs into address/tx prefills |
| `ContextMenu` | Right-click menu on graph elements |

## How the Systems Connect

```
User → Frontend (Next.js)
         │
         ├── REST API ──→ Backend (NestJS)
         │                  ├── Cases/Investigations/Traces (TypeORM → Postgres)
         │                  ├── Blockchain providers (Etherscan, Tronscan)
         │                  └── AI module
         │                       ├── Anthropic Claude (streaming)
         │                       ├── Tools (case data, skills, scripts)
         │                       └── Script execution (child Node.js process)
         │                            └── fetch() → blockchain APIs
         │                            └── fetch() → POST /traces/:id/import-transactions
         │
         └── SSE stream ──→ POST /conversations/:id/chat
                            (text deltas, tool events, graph_updated, done)
```

The backend is the single authority for all data mutations. Both the UI and AI scripts go through REST endpoints. AI scripts run in a sandboxed child process with `fetch()`, blockchain API key env vars, and `API_URL` — they fetch blockchain data and POST to the import endpoint to mutate the graph.
