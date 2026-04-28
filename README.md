# Daubert

Blockchain transaction investigation tool. Trace fund flows across EVM-compatible chains, organize findings into cases, and use AI-assisted analysis.

## Architecture

Monorepo: Next.js frontend + NestJS backend + OpenAPI contracts.

- **Frontend**: Next.js 14 (App Router), Cytoscape.js, Tailwind CSS
- **Backend**: NestJS, TypeORM, PostgreSQL
- **Contracts**: OpenAPI YAML specs, codegen for shared types
- **Auth**: Firebase Authentication (Google sign-in) + App Check (reCAPTCHA Enterprise)

## Infrastructure

| Component | Dev | Prod |
|-----------|-----|------|
| Database | Postgres 16 (Docker, port 5433) | Neon |
| Backend | localhost:8081 | Cloud Run (GCP) |
| Frontend | localhost:3001 | Vercel |
| Auth | Firebase (daubert-dev) | Firebase (daubert-prod) |

## Local Development

### Prerequisites

- Node.js 22+
- Docker (for Postgres)

### Setup

```bash
# Start Postgres
npm run db

# Start backend (port 8081)
npm run be

# Start frontend (port 3001)
npm run fe

# Regenerate API types from OpenAPI specs
npm run gen
```

### Environment Files

- `backend/.env.development` -- backend dev config (DB, API keys, Firebase)
- `backend/.env.production` -- prod config (Neon, Cloud Run secrets)
- `frontend/.env.development` -- frontend dev config (API URL, Firebase)

## Database Migrations

Migrations are managed via `./migrations.sh`. Dev uses `synchronize: true` (auto-sync from entities). Migrations are a prod-only artifact.

```bash
# Generate a migration against prod
./migrations.sh --prod --generate MigrationName

# Apply migrations to prod
./migrations.sh --prod --run
```

Never apply migrations directly -- always use the script.

## Data Model

Cases > Investigations > Traces (graph data as JSONB)

Supporting entities: Users, Case Members, Conversations, Messages, Productions, Labeled Entities, Script Runs, Data Room Connections.

## Backend Modules

`auth`, `users`, `cases`, `investigations`, `traces`, `blockchain`, `ai`, `labeled-entities`, `productions`, `data-room`, `export`, `script`, `admin`

## Deployment

1. Generate and run initial migration against Neon
2. Run `./migrate-dev-to-prod.sh` to copy local data
3. Cloud Run auto-deploys from `main` branch
4. Vercel deploys frontend from `main` branch
5. Smoke test: login > create case > run trace > AI chat
