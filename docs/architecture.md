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
| `npm run db` | Start Postgres 16 container on port 5455 |
| `npm run be` | NestJS dev server on port 8081 |
| `npm run fe` | Next.js dev server on port 3001 |
| `npm run gen` | Generate `api-types.ts` from OpenAPI |

## Environment Variables

### Backend (`backend/.env.development`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection |
| `ANTHROPIC_API_KEY` | Claude API (chat, script-writing, declarant CV extraction) |
| `ETHERSCAN_API_KEY` | Etherscan V2 |
| `TRONSCAN_API_KEY` | Tronscan / TronGrid |
| `FIREBASE_PROJECT_ID` | Firebase Auth |
| `FIREBASE_CLIENT_EMAIL` | Firebase Auth |
| `FIREBASE_PRIVATE_KEY` | Firebase Auth |
| `GCS_DATA_ROOM_BUCKET` | Data Room + org-files storage bucket (required in production) |
| `DATA_ROOM_LOCAL_DIR` | Optional local-disk storage dir (non-prod fallback) |
| `FRONTEND_URL` | Frontend base URL (used to build links in transactional email) |
| `OAUTH_ISSUER_URL` | Public base URL of this backend; OAuth issuer identifier for the MCP authorization server |
| `OAUTH_STATE_SECRET` | Signs OAuth state params (CSRF protection), must be ≥32 chars |
| `OAUTH_ACCESS_TOKEN_TTL_S` / `OAUTH_REFRESH_TOKEN_TTL_DAYS` / `OAUTH_CODE_TTL_S` | Optional token TTL overrides for the OAuth flow |
| `DAUBERT_WEBSITE_API_KEY` | Shared secret the marketing site sends in `X-Daubert-Website-Key` for `/external/trace/*` |
| `RESEND_API_KEY` | Transactional email (OTP codes) via Resend |
| `EMAIL_FROM_ADDRESS` / `EMAIL_REPLY_TO` | From/reply-to shape for transactional email |

### Frontend

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Backend base URL (defaults `http://localhost:8081`) |
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | OAuth client ID for the Drive Picker's `drive.file` token (GIS) |
| `NEXT_PUBLIC_DRIVE_PICKER_KEY` | Google Drive Picker API key |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_MEASUREMENT_ID` | Firebase web SDK config (`src/lib/firebase.ts`) |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | reCAPTCHA for Firebase Auth |
| `NEXT_PUBLIC_SIGNUP_ENDPOINT` | "Request access" flow on the login page |

## Backend

NestJS app on port 8081. CORS enabled. Global `ValidationPipe` with whitelist + transform.

### Module Map

The real module set, as imported by `backend/src/app.module.ts` (22 modules; `ConfigModule` and `DatabaseModule` are infra, not domain modules, and are omitted here):

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | Firebase token verification, user identification, guards (RoleGuard, OrgRoleGuard, SuperAdminGuard), `AccessPrincipal`, `CaseAccessService` |
| `OAuthModule` | OAuth 2.1 authorization server (PKCE S256, no client secret) that authorizes external agents for MCP: `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/oauth/register` (RFC 7591), discovery metadata, plus the caller's own `/me/oauth-sessions` and `/me/agent-actions` |
| `McpModule` | Bring-your-own-agent MCP server: a single `POST /mcp` Streamable-HTTP endpoint that lets external agents (Claude Desktop, claude.ai, Claude Code) call org/case-scoped tools under an OAuth-issued, org-bound session |
| `UsersModule` | User entity module; no routes of its own anymore (`GET /users/me` was superseded by `/auth/me`), kept for future user-management endpoints |
| `OrganizationsModule` | Org CRUD, org membership, org invites (`/orgs/:org/*`, `/org-invites/*`) |
| `CasesModule` | Case CRUD, case membership (scoped under an org via `case.orgId`) |
| `InvitesModule` | Case invites (`/cases/:caseId/invites`, `/invites/:code`) |
| `InvestigationsModule` | Investigation CRUD, duplication, cross-trace advanced search (`search-between`) |
| `TracesModule` | Trace CRUD, graph data, node/edge/group/bundle ops, import-transactions |
| `BlockchainModule` | Multi-chain tx fetching via provider pattern (Etherscan, Tronscan) |
| `AiModule` | Agentic chat, LLM provider, tool dispatch, script execution orchestration |
| `ScriptModule` | isolated-vm V8 sandbox + signed script token issuance/verification (no HTTP routes of its own) |
| `ExternalTraceModule` | Script-callable trace import endpoint (`/external/trace/*`), token-authed |
| `LabeledEntitiesModule` | Crypto entity registry (public read, superadmin CUD) |
| `ProductionsModule` | Reports (HTML/TipTap), charts (Chart.js), chronologies, and structured legal declarations |
| `DeclarantsModule` | Org-scoped declarant (expert witness) profiles: CRUD, Claude-based CV/prior-declaration extraction, and per-declarant file attachments, stored under the same `StorageProvider` as the data room but org-scoped |
| `DeclarationLibraryModule` | Org-scoped library of reusable declaration content blocks (declarant-profile boilerplate and general boilerplate paragraphs) for reuse across declarations |
| `DataRoomModule` | Built-in per-case file storage (GCS/local `StorageProvider`) with folders and a Google Drive one-shot import/export, see `docs/data-room.md` |
| `ExportModule` | PDF/DOCX/HTML export via server-side Puppeteer and `html-to-docx`; also serves the declaration-format registry and multi-item exhibit composition |
| `EmailModule` | Transactional email (Resend): OTP codes, invite emails |
| `AuthEmailModule` | Email/OTP sign-in (`/auth/email/otp/*`), alongside Firebase's Google/Microsoft OAuth |
| `SuperadminModule` | Platform-level admin CRUD across orgs, cases, users, labeled entities, and token-usage dashboards (`/superadmin/*`) |

### Auth Model

Three role layers, evaluated by `AccessPrincipal`:

1. **Platform** — `user.is_super_admin` (boolean). Gated by `@RequireSuperAdmin()` + `SuperAdminGuard`. Used by `/superadmin/*` routes.
2. **Organization** — `organization_members.role` ∈ {`admin`, `member`, `guest`}. Gated by `@RequireOrgRole(...)` + `OrgRoleGuard`. Used by `/orgs/:org/*` routes. Org `admin` implies owner access to every case in the org.
3. **Case** — `case_members.role` ∈ {`owner`, `editor`, `viewer`}. Gated by `@RequireRole(...)` + `RoleGuard`. Used by `/cases/:caseId/*` routes and everything under a case (investigations, traces, productions, conversations, data-room).

Case-scoped and org-scoped collection routes (e.g. `GET /cases/:caseId/productions`, `GET /orgs/:org/declarants`) carry a declarative `@RequireRole`/`@RequireOrgRole` decorator. Single-resource routes reached by bare id (`/investigations/:id`, `/traces/:id`, `/productions/:id`, `/conversations/:id`) have no route-level decorator; the global `AuthGuard` still runs, but the case/org role check happens in the service layer via `AccessPrincipal` + `CaseAccessService`.

Scripts execute under a signed token issued by `ScriptModule` (sent as an `x-script-token` header, accepted anywhere the global `AuthGuard` runs) and carry the initiator's case context so loopback calls (e.g., to `/external/trace/*`, `/traces/:id/import-transactions`) remain role-bound. `/conversations/:id/chat` and `/exports/*` explicitly reject script-token principals.

MCP requests carry a fourth, parallel principal kind: an OAuth access token resolves to `{ kind: 'mcp', userId, organizationId, sessionId }` (see `McpAuthHelper`), re-checked against live org membership on every call rather than cached for the token's lifetime.

### All Endpoints

No global route prefix. Every route runs the global `AuthGuard` (Firebase bearer or `x-script-token`) unless marked `@Public`.

```
GET    /health                           (@Public)
GET    /auth/me
PATCH  /auth/me

# Email / OTP sign-in
POST   /auth/email/otp/send              (@Public, throttled 3/60s)
POST   /auth/email/otp/verify            (@Public, throttled 10/60s)

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
GET    /org-invites/:code               (@Public, preview by code)
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
GET    /invites/:code                   (@Public, preview by code)
POST   /invites/:code/accept

# Investigations / traces / blockchain
GET    /cases/:caseId/investigations
POST   /cases/:caseId/investigations
GET    /investigations/:id
PATCH  /investigations/:id
DELETE /investigations/:id
POST   /investigations/:id/duplicate
GET    /investigations/:id/script-runs
POST   /investigations/:id/search-between   (advanced cross-trace search)

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
POST   /traces/:traceId/bundles
PATCH  /traces/:traceId/bundles/:bundleId
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
POST   /conversations/:id/chat          (hand-rolled SSE stream over POST; rejects script tokens)
POST   /script-runs/:id/rerun

# Script sandbox loopback (token-authed, called by isolated-vm scripts)
GET    /external/trace                  (website-key guarded, not script token; marketing-site widget)

GET    /labeled-entities
GET    /labeled-entities/lookup
GET    /labeled-entities/:id

# Productions (reports, charts, chronologies, declarations)
GET    /cases/:caseId/productions
POST   /cases/:caseId/productions
GET    /productions/:id
PATCH  /productions/:id
DELETE /productions/:id
GET    /productions/:id/declaration-preview   (returns text/html, not JSON)

# Declaration formats: jurisdiction registry (5: CA, NY, Federal Sec. 1746, TX, FL)
GET    /declaration-formats

# Data Room (built-in per-case storage; see docs/data-room.md)
GET    /cases/:caseId/data-room/files
GET    /cases/:caseId/data-room/files/:fileId/download
POST   /cases/:caseId/data-room/files              (streaming upload via busboy, 50MB cap)
DELETE /cases/:caseId/data-room/files/:fileId
POST   /cases/:caseId/data-room/import/google-drive
POST   /cases/:caseId/data-room/export/google-drive
GET    /cases/:caseId/data-room/contents           (folder + breadcrumb listing)
POST   /cases/:caseId/data-room/folders
DELETE /cases/:caseId/data-room/folders/:folderId
PATCH  /cases/:caseId/data-room/files/:fileId/move
PATCH  /cases/:caseId/data-room/folders/:folderId/move

# Declarants (org-scoped expert-witness profiles)
GET    /orgs/:org/declarants
POST   /orgs/:org/declarants
PATCH  /orgs/:org/declarants/:declarantId
DELETE /orgs/:org/declarants/:declarantId
POST   /orgs/:org/declarants/extract              (Claude CV / prior-declaration extraction)
GET    /orgs/:org/declarants/:declarantId/files
POST   /orgs/:org/declarants/:declarantId/files
GET    /orgs/:org/declarants/:declarantId/files/:fileId/download
DELETE /orgs/:org/declarants/:declarantId/files/:fileId

# Org files: cross-declarant "Files" tab
GET    /orgs/:org/files

# Declaration library (org-scoped reusable boilerplate blocks)
GET    /orgs/:org/declaration-library
POST   /orgs/:org/declaration-library
PATCH  /orgs/:org/declaration-library/:blockId
DELETE /orgs/:org/declaration-library/:blockId

# Export (PDF/DOCX/CSV via Puppeteer + html-to-docx)
POST   /exports/productions/:id
POST   /exports/graph
POST   /exports/exhibit                 (multi-item exhibit: productions + investigation graph snapshots)

# MCP: bring-your-own-agent server
POST   /mcp                             (@Public + IP-throttled; auth is OAuth-bearer, handled inside the MCP layer)

# OAuth: authorization server for MCP clients
GET    /oauth/authorize                 (@Public; dual-mode redirect/JSON bridge)
POST   /oauth/authorize/preview         (@Public, consent screen preview)
POST   /oauth/authorize/complete        (@Public, issues auth code after consent)
POST   /oauth/authorize/deny            (@Public)
POST   /oauth/token                     (@Public, RFC 6749 token endpoint)
POST   /oauth/revoke                    (@Public, RFC 7009)
POST   /oauth/register                  (@Public + IP-throttled, RFC 7591 dynamic client registration)
GET    /.well-known/oauth-authorization-server   (@Public, RFC 8414)
GET    /.well-known/oauth-protected-resource     (@Public, RFC 9728)

# Self-service: connected agents (the caller's own OAuth sessions)
POST   /me/oauth/start-connect
GET    /me/oauth-sessions
GET    /me/agent-actions
POST   /me/oauth-sessions/:id/revoke

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

# Superadmin: token usage / cost dashboards
GET    /superadmin/token-usage/overview
GET    /superadmin/token-usage/by-org
GET    /superadmin/token-usage/by-user
GET    /superadmin/token-usage/by-case
GET    /superadmin/token-usage/by-conversation
GET    /superadmin/token-usage/org-model-matrix
GET    /superadmin/token-usage/cache-effectiveness
```

## Frontend

Next.js 14 with App Router.

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Case list across the user's org memberships |
| `/login` | Google/Microsoft OAuth (Firebase popup) + email/OTP sign-in |
| `/account` | Self profile, connected MCP agents, agent activity log |
| `/orgs/[orgSlug]` | Redirects to `/orgs/[orgSlug]/declarations` (no dashboard of its own) |
| `/orgs/[orgSlug]/declarations` | Org declarant roster + declaration library (reusable boilerplate) |
| `/orgs/[orgSlug]/files` | Org-wide file list across all declarants |
| `/orgs/[orgSlug]/cases` | Admin-only cross-case browser for the org (non-admins redirected to settings) |
| `/orgs/[orgSlug]/settings` | Org settings, members, invites |
| `/cases/[caseId]/investigations` | Investigation workspace (graph + productions) |
| `/cases/[caseId]/data-room` | Case file browser (built-in storage + Google Drive import/export) |
| `/cases/[caseId]/productions` | Productions viewer (reports, charts, chronologies, declarations) |
| `/cases/[caseId]/settings` | Case settings, members, invites |
| `/invite/[code]` | Case invite redemption page |
| `/org-invite/[code]` | Org invite redemption page |
| `/oauth/authorize` | OAuth bridge page for MCP clients (carries the Firebase session across a top-level navigation) |
| `/oauth/consent` | Consent screen for an external agent requesting org access |
| `/superadmin` | Redirects to `/superadmin/orgs` |
| `/superadmin/users` | Platform user management |
| `/superadmin/orgs` | Org management + trash |
| `/superadmin/cases` | Cross-org case browser |
| `/superadmin/entities` | Labeled entity management |
| `/superadmin/token-usage` | Token/cost dashboards (by org, user, case, conversation, model) |
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

The three-column layout lives in `cases/[caseId]/(workspace)/layout.tsx` via `CaseShell` (`components/Workspace/CaseShell.tsx`), using `CaseProvider` context. Both sidebar and chat panel are resizable with drag handles. Pages push data into context via `updateSidebar()`. `/cases/[caseId]/settings` is a sibling of `(workspace)`, so it does not get this three-pane chrome.

### Org Workspace (tab layout)

The org side (`/orgs/[orgSlug]/(workspace)/layout.tsx`) uses a flat top-level tab bar instead of the case three-pane shell: **Declarations**, **Files**, **Cases** (admin-only, hidden from the nav for non-admins, who are also redirected server-side if they hit the URL directly), **Settings**. `isOrgAdmin` is derived from the caller's org role in `AuthProvider`.

### Empty-case onboarding

A case with zero investigations shows `CaseOnboardingWizard` (`components/Onboarding/CaseOnboardingWizard.tsx`) in the center pane instead of the usual empty state, gated to owners/editors and skippable per-session. Its three steps -- declarant, seed trace, declaration -- create or pick a declarant (`DeclarantModal`), fetch and import a wallet's transaction history into a new investigation/trace (`useCaseSeed`), and scaffold a declaration production from it. Each step can be skipped independently. Once an investigation exists, `GettingStartedRail` (`components/Onboarding/GettingStartedRail.tsx`) replaces the wizard with a small dismissible checklist (seed trace, label wallets, expand flows, draft declaration) that tracks progress via a stored `ChecklistState` record.

### Key Components (curated)

| Category | Components |
|----------|-----------|
| Auth | AuthGuard, AuthProvider, SuperAdminGuard, UserMenu |
| Layout | InvestigationsSidebar, Header, NewPrimaryModal |
| Graph | GraphCanvas, DetailsPanel, FloatingPanel, ContextMenu, SidePanel, ChainSelect |
| Forms | WalletForm, TransactionForm, TraceForm, InvestigationForm, LinkInputModal, TagInput, ColorPicker |
| Batch ops | BatchEditPanel, EdgeBatchPanel, StagingPanel |
| Data input | FetchModal, FetchHistoryPanel, CitationPicker |
| Productions | ProductionViewer, ReportEditor, ChartViewer, ChronologyTable, DeclarantPicker, DeclarationLibraryPicker |
| Declarants | DeclarantModal (shared create/edit form with Claude CV extraction) |
| Onboarding | CaseOnboardingWizard, GettingStartedRail |
| AI | AIChat, ScriptsPanel |

### Key Hooks

| Hook | Purpose |
|------|---------|
| `useInvestigation` | Reducer-based graph state (13 actions, 50-item undo history) |
| `useCytoscape` | Cytoscape.js initialization, React-driven selection, incremental sync |
| `useCytoscapeOverlays` | DOM overlays (sublabels, resize handles, edge orientations) |
| `useLabeledEntities` | Cached entity registry fetch |
| `useCaseSeed` | Fetch-first case seed pipeline: fetch each address's history, dedupe, create an investigation + trace, import the transactions |

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
         │                  ├── Productions (reports, charts, chronologies, declarations)
         │                  ├── Declarants + Declaration Library (org-scoped)
         │                  ├── Data Room (built-in GCS/local StorageProvider + Drive one-shot import/export)
         │                  ├── Export (Puppeteer → PDF/HTML; html-to-docx → DOCX)
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

External agent (Claude Desktop, claude.ai, Claude Code, ...)
         │
         ├── OAuth 2.1 dance ──→ /oauth/authorize → (browser bridge: /oauth/authorize, /oauth/consent)
         │                       → /oauth/token  (org-bound access + refresh tokens)
         │
         └── MCP (Streamable HTTP) ──→ POST /mcp
                            Bearer token re-checked against live org membership on every call.
                            Tool groups: navigate, read, blockchain, write -- same
                            case/org role gates as the REST API, same Postgres data.
                            Every call logged to AgentAuditLogEntity (visible at /account
                            and /me/agent-actions).
```

The backend is the single authority for all data mutations. The UI, AI scripts, and external MCP agents all go through the same REST/service layer -- none of them get a private data path. AI scripts run in an isolated-vm V8 sandbox with `fetch()`, blockchain API key env vars, and `API_URL` -- they fetch blockchain data and POST to the import endpoint to mutate the graph. External agents authenticate via OAuth rather than Firebase, but are resolved to the same `AccessPrincipal` shape before touching any case or org resource.
