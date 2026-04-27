# Architecture

Daubert is a blockchain transaction investigation tool. Monorepo with a Next.js frontend, NestJS backend, and OpenAPI contracts.

## Repository Layout

```
daubert/
├── frontend/          Next.js 14 (App Router), Tailwind, Cytoscape.js
├── backend/           NestJS, TypeORM, Postgres
├── contracts/         OpenAPI YAML (paths/, schemas/)
└── docs/              Documentation
```

## Run Commands

| Command | What it does |
|---------|-------------|
| `npm run db` | Start Postgres 16 container on port 5433 |
| `npm run be` | NestJS dev server on port 8081 |
| `npm run fe` | Next.js dev server on port 3001 |
| `npm run gen` | Generate `api-types.ts` from OpenAPI |

## Environment Variables

### Backend (`backend/.env.development`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection |
| `ANTHROPIC_API_KEY` | Claude API |
| `ETHERSCAN_API_KEY` | Etherscan V2 |
| `TRONSCAN_API_KEY` | Tronscan / TronGrid |
| `FIREBASE_PROJECT_ID` | Firebase Auth |
| `FIREBASE_CLIENT_EMAIL` | Firebase Auth |
| `FIREBASE_PRIVATE_KEY` | Firebase Auth |
| `DATAROOM_ENCRYPTION_KEY` | AES-256-GCM key for Drive token encryption (64 hex chars) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth for Data Room |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth for Data Room |
| `GOOGLE_OAUTH_REDIRECT_URI` | Google OAuth for Data Room |
| `FRONTEND_URL` | Frontend base URL (for OAuth redirects) |

### Frontend

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Backend base URL (defaults `http://localhost:8081`) |
| `NEXT_PUBLIC_DRIVE_PICKER_KEY` | Google Drive Picker API key |

## Backend

NestJS app on port 8081. CORS enabled. Global `ValidationPipe` with whitelist + transform.

### Module Map (12 modules)

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | Firebase token verification, user identification, CaseMemberGuard, IsAdminGuard |
| `UsersModule` | User entity |
| `CasesModule` | Case CRUD, case membership |
| `InvestigationsModule` | Investigation CRUD |
| `TracesModule` | Trace CRUD, graph data, node/edge/group/bundle ops, import-transactions |
| `BlockchainModule` | Multi-chain tx fetching via provider pattern (Etherscan, Tronscan) |
| `AiModule` | Agentic chat, LLM provider, tool dispatch, script execution (isolated-vm sandbox) |
| `LabeledEntitiesModule` | Crypto entity registry (public read, admin CUD) |
| `ProductionsModule` | Reports (HTML/TipTap), charts (Chart.js), chronologies |
| `DataRoomModule` | Google Drive integration — OAuth, file list/upload/download, encrypted tokens |
| `ExportModule` | PDF/HTML export via server-side Puppeteer |
| `AdminModule` | Admin CRUD for users, cases, members, labeled entities |

### All Endpoints

```
GET    /health
GET    /auth/me

GET    /cases
GET    /cases/:caseId
PATCH  /cases/:caseId
DELETE /cases/:caseId

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
PATCH  /traces/:traceId/nodes/:nodeId
PATCH  /traces/:traceId/edges/:edgeId
DELETE /traces/:traceId/nodes/:nodeId
DELETE /traces/:traceId/edges/:edgeId
POST   /traces/:traceId/groups
PATCH  /traces/:traceId/groups/:groupId
DELETE /traces/:traceId/groups/:groupId
GET    /traces/:traceId/bundles
DELETE /traces/:traceId/bundles/:bundleId
POST   /traces/:id/import-transactions

POST   /blockchain/fetch-history
POST   /blockchain/get-transaction
POST   /blockchain/get-address-info

POST   /conversations
GET    /conversations
GET    /conversations/:id/messages
DELETE /conversations/:id
POST   /conversations/:id/chat          (SSE stream)
POST   /script-runs/:id/rerun

GET    /labeled-entities
GET    /labeled-entities/lookup
GET    /labeled-entities/:id

GET    /cases/:caseId/productions
POST   /cases/:caseId/productions
GET    /productions/:id
PATCH  /productions/:id
DELETE /productions/:id

POST   /cases/:caseId/data-room/connect
GET    /data-room/oauth-callback         (@Public — HMAC state auth)
GET    /cases/:caseId/data-room
PATCH  /cases/:caseId/data-room/folder
GET    /cases/:caseId/data-room/access-token
DELETE /cases/:caseId/data-room
GET    /cases/:caseId/data-room/files
GET    /cases/:caseId/data-room/files/:fileId/download
POST   /cases/:caseId/data-room/files    (streaming upload via busboy)

POST   /exports/productions/:id
POST   /exports/graph

GET    /admin/users
POST   /admin/users
DELETE /admin/users/:id
GET    /admin/cases
POST   /admin/cases
DELETE /admin/cases/:id
GET    /admin/cases/:id/members
POST   /admin/cases/:id/members
PATCH  /admin/cases/:id/members/:userId
DELETE /admin/cases/:id/members/:userId

POST   /admin/labeled-entities
PATCH  /admin/labeled-entities/:id
DELETE /admin/labeled-entities/:id
```

## Frontend

Next.js 14 with App Router.

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Case list (home) |
| `/login` | Google OAuth sign-in |
| `/cases/[caseId]/investigations` | Investigation workspace (graph + productions) |
| `/cases/[caseId]/data-room` | Google Drive file browser |
| `/admin` | Admin dashboard |
| `/admin/users` | User management |
| `/admin/cases` | Case management |
| `/admin/entities` | Labeled entity management |
| `/entities` | Public entity browser |
| `/entities/[id]` | Entity detail |

### Case Layout (shared via CaseContext)

```
┌──────────────┬────────────────────────────────┬──────────────┐
│              │                                │              │
│   Sidebar    │     Center Content             │   AI Chat    │
│  (resizable) │  (investigations/data-room)    │  (resizable) │
│              │                                │              │
│ Investigations│  Graph Canvas / Production    │ Conversations│
│ Productions  │  Viewer / Data Room            │ Messages     │
│ Data Room    │                                │ Tool Status  │
│ Scripts      │  [Floating panels/modals]      │              │
│              │                                │              │
└──────────────┴────────────────────────────────┴──────────────┘
```

The three-column layout lives in `cases/[caseId]/layout.tsx` using `CaseProvider` context. Both sidebar and chat panel are resizable with drag handles. Pages push data into context via `updateSidebar()`.

### Key Components (32 total)

| Category | Components |
|----------|-----------|
| Auth | AuthGuard, AuthProvider, AdminGuard, UserMenu |
| Layout | InvestigationsSidebar, Header, NewPrimaryModal |
| Graph | GraphCanvas, DetailsPanel, FloatingPanel, ContextMenu, SidePanel |
| Forms | WalletForm, TransactionForm, TraceForm, InvestigationForm, LinkInputModal, TagInput, ColorPicker |
| Batch ops | BatchEditPanel, EdgeBatchPanel, StagingPanel |
| Data input | FetchModal, FetchHistoryPanel, CitationPicker |
| Productions | ProductionViewer, ReportEditor, ChartViewer, ChronologyTable |
| AI | AIChat, ScriptsPanel |

### Key Hooks

| Hook | Purpose |
|------|---------|
| `useInvestigation` | Reducer-based graph state (13 actions, 50-item undo history) |
| `useCytoscape` | Cytoscape.js initialization, React-driven selection, incremental sync |
| `useCytoscapeOverlays` | DOM overlays (sublabels, resize handles, edge orientations) |
| `useLabeledEntities` | Cached entity registry fetch |

### Key Patterns

**State management** -- `useInvestigation` reducer owns all graph state.

**Auto-save** -- 1s debounce persists traces to backend.

**Selection** -- React-driven. `selectedNodeIds`/`selectedEdgeIds` are the single source of truth; `useCytoscape` paints `cy-sel` class from them.

**API client** -- Typed fetch wrapper in `lib/api-client.ts`.

**Context** -- `CaseContext` shares sidebar data, productions, modal state across pages.

## How the Systems Connect

```
User → Frontend (Next.js)
         │
         ├── REST API ──→ Backend (NestJS)
         │                  ├── Auth (Firebase token verification)
         │                  ├── Cases/Investigations/Traces (TypeORM → Postgres)
         │                  ├── Blockchain providers (Etherscan, Tronscan)
         │                  ├── Productions (reports, charts, chronologies)
         │                  ├── Data Room (Google Drive via googleapis)
         │                  ├── Export (Puppeteer → PDF/HTML)
         │                  ├── Labeled Entities registry
         │                  └── AI module
         │                       ├── Anthropic Claude (streaming, adaptive thinking)
         │                       ├── Tools (case data, skills, scripts, entities, productions)
         │                       └── Script execution (isolated-vm V8 sandbox)
         │                            └── Domain-whitelisted fetch() → blockchain APIs
         │                            └── fetch() → POST /traces/:id/import-transactions
         │
         └── SSE stream ──→ POST /conversations/:id/chat
                            (text deltas, tool events, graph_updated, done)
```

The backend is the single authority for all data mutations. Both the UI and AI scripts go through REST endpoints. AI scripts run in an isolated-vm V8 sandbox with `fetch()`, blockchain API key env vars, and `API_URL` -- they fetch blockchain data and POST to the import endpoint to mutate the graph.
