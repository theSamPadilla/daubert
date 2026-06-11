# Architecture

Daubert is a multi-user AI platform for blockchain investigations. Users belong to **organizations**; **cases** live inside an organization; case members get a per-case role. Monorepo with a Next.js frontend, NestJS backend, and OpenAPI contracts.

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
| `GCS_DATA_ROOM_BUCKET` | Data Room file storage bucket (required in production) |
| `DATA_ROOM_LOCAL_DIR` | Optional local-disk storage dir (non-prod fallback) |
| `FRONTEND_URL` | Frontend base URL (used to build links in transactional email) |

### Frontend

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Backend base URL (defaults `http://localhost:8081`) |
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | OAuth client ID for the Drive Picker's `drive.file` token (GIS) |
| `NEXT_PUBLIC_DRIVE_PICKER_KEY` | Google Drive Picker API key |

## Backend

NestJS app on port 8081. CORS enabled. Global `ValidationPipe` with whitelist + transform.

### Module Map (16 modules)

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | Firebase token verification, user identification, guards (RoleGuard, OrgRoleGuard, SuperAdminGuard), `AccessPrincipal`, `CaseAccessService` |
| `UsersModule` | User entity, self profile (`/users/me`) |
| `OrganizationsModule` | Org CRUD, org membership, org invites (`/orgs/:org/*`, `/org-invites/*`) |
| `CasesModule` | Case CRUD, case membership (scoped under an org via `case.orgId`) |
| `InvitesModule` | Case invites (`/cases/:caseId/invites`, `/invites/:code`) |
| `InvestigationsModule` | Investigation CRUD |
| `TracesModule` | Trace CRUD, graph data, node/edge/group/bundle ops, import-transactions |
| `BlockchainModule` | Multi-chain tx fetching via provider pattern (Etherscan, Tronscan) |
| `AiModule` | Agentic chat, LLM provider, tool dispatch, script execution orchestration |
| `ScriptModule` | isolated-vm V8 sandbox + signed script token issuance/verification |
| `ExternalTraceModule` | Script-callable trace import endpoint (`/external/trace/*`), token-authed |
| `LabeledEntitiesModule` | Crypto entity registry (public read, superadmin CUD) |
| `ProductionsModule` | Reports (HTML/TipTap), charts (Chart.js), chronologies |
| `DataRoomModule` | Google Drive integration — OAuth, file list/upload/download, encrypted tokens |
| `ExportModule` | PDF/HTML export via server-side Puppeteer |
| `SuperadminModule` | Platform-level admin CRUD across orgs, cases, users, labeled entities (`/superadmin/*`) |

### Auth Model

Three role layers, evaluated by `AccessPrincipal`:

1. **Platform** — `user.is_super_admin` (boolean). Gated by `@RequireSuperAdmin()` + `SuperAdminGuard`. Used by `/superadmin/*` routes.
2. **Organization** — `organization_members.role` ∈ {`admin`, `member`, `guest`}. Gated by `@RequireOrgRole(...)` + `OrgRoleGuard`. Used by `/orgs/:org/*` routes. Org `admin` implies owner access to every case in the org.
3. **Case** — `case_members.role` ∈ {`owner`, `editor`, `viewer`}. Gated by `@RequireRole(...)` + `RoleGuard`. Used by `/cases/:caseId/*` routes and everything under a case (investigations, traces, productions, conversations, data-room).

Scripts execute under a signed token issued by `ScriptModule` and carry the initiator's case context so loopback calls (e.g., to `/external/trace/*`) remain role-bound.

### All Endpoints

```
GET    /health
GET    /auth/me

GET    /users/me
PATCH  /users/me

# Organizations
GET    /orgs/:org
PATCH  /orgs/:org
GET    /orgs/:org/members
POST   /orgs/:org/members
PATCH  /orgs/:org/members/:userId
DELETE /orgs/:org/members/:userId
POST   /orgs/:org/members/me/leave

# Organization invites
POST   /orgs/:org/invites
GET    /orgs/:org/invites
DELETE /orgs/:org/invites/:inviteId
GET    /org-invites/:code               (@Public — preview by code)
POST   /org-invites/:code/accept

# Cases (scoped to the caller's org membership)
POST   /cases
GET    /cases
GET    /cases/:caseId
PATCH  /cases/:caseId
DELETE /cases/:caseId
GET    /cases/:caseId/members
POST   /cases/:caseId/members
PATCH  /cases/:caseId/members/:userId
DELETE /cases/:caseId/members/:userId
POST   /cases/:caseId/members/me/leave

# Case invites
POST   /cases/:caseId/invites
GET    /cases/:caseId/invites
DELETE /cases/:caseId/invites/:inviteId
GET    /invites/:code                   (@Public — preview by code)
POST   /invites/:code/accept

# Investigations / traces / blockchain (unchanged)
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

# Conversations (scoped to a case)
POST   /cases/:caseId/conversations
GET    /cases/:caseId/conversations
GET    /conversations/:id/messages
DELETE /conversations/:id
POST   /conversations/:id/chat          (SSE stream)
POST   /script-runs/:id/rerun

# Script sandbox loopback (token-authed, called by isolated-vm scripts)
POST   /external/trace/import           (script token)

GET    /labeled-entities
GET    /labeled-entities/lookup
GET    /labeled-entities/:id

GET    /cases/:caseId/productions
POST   /cases/:caseId/productions
GET    /productions/:id
PATCH  /productions/:id
DELETE /productions/:id

POST   /cases/:caseId/data-room/connect
GET    /data-room/oauth-callback        (@Public — HMAC state auth)
GET    /cases/:caseId/data-room
PATCH  /cases/:caseId/data-room/folder
GET    /cases/:caseId/data-room/access-token
DELETE /cases/:caseId/data-room
GET    /cases/:caseId/data-room/files
GET    /cases/:caseId/data-room/files/:fileId/download
POST   /cases/:caseId/data-room/files   (streaming upload via busboy)

POST   /exports/productions/:id
POST   /exports/graph

# Superadmin (gated by @RequireSuperAdmin)
GET    /superadmin/users
POST   /superadmin/users
PATCH  /superadmin/users/:id/super-admin
DELETE /superadmin/users/:id

GET    /superadmin/cases

GET    /superadmin/orgs
GET    /superadmin/orgs/trash
POST   /superadmin/orgs
DELETE /superadmin/orgs/:id
POST   /superadmin/orgs/:id/restore
POST   /superadmin/orgs/:id/purge

POST   /superadmin/labeled-entities
PATCH  /superadmin/labeled-entities/:id
DELETE /superadmin/labeled-entities/:id
```

## Frontend

Next.js 14 with App Router.

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Case list across the user's org memberships |
| `/login` | Google OAuth sign-in |
| `/orgs/[orgSlug]` | Org dashboard |
| `/orgs/[orgSlug]/settings` | Org settings, members, invites |
| `/cases/[caseId]/investigations` | Investigation workspace (graph + productions) |
| `/cases/[caseId]/data-room` | Google Drive file browser |
| `/cases/[caseId]/productions` | Productions viewer |
| `/cases/[caseId]/settings` | Case settings, members, invites |
| `/invite/[code]` | Case invite redemption page |
| `/org-invite/[code]` | Org invite redemption page |
| `/superadmin` | Superadmin dashboard |
| `/superadmin/users` | Platform user management |
| `/superadmin/orgs` | Org management + trash |
| `/superadmin/cases` | Cross-org case browser |
| `/superadmin/entities` | Labeled entity management |
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
| Auth | AuthGuard, AuthProvider, SuperAdminGuard, UserMenu |
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
