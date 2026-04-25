# Production Deployment Checklist

Targets: **DB on Neon, Frontend on Vercel, Backend on Cloud Run (GCP)**.
Mirrors the deployment shape of `~/Work/ByCrux/dev/stackpad`.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/Dockerfile` | Create | Backend can be built and deployed to Cloud Run |
| 2 | `backend/.dockerignore` | Create | Image stays small; `.env*`, `node_modules`, `dist` not shipped |
| 3 | `backend/src/main.ts` | Modify | Server binds `0.0.0.0:$PORT`, locks CORS to allowed origins, adds helmet + SIGTERM + crash handlers — required for Cloud Run |
| 4 | `backend/src/config/database.config.ts` | Modify | Postgres connects to Neon over SSL; `synchronize` off in prod so deploys don't mutate schema |
| 5 | `backend/src/database/cli-data-source.ts` | Create | TypeORM CLI entrypoint for generating + running migrations |
| 6 | `backend/src/database/migrations/` | Create | Versioned schema; replaces `synchronize: true` for prod |
| 7 | `backend/package.json` | Modify | `migration:generate` / `migration:run` / `migration:revert` scripts available to developers |
| 8 | `backend/src/config/env.validation.ts` | Modify | Prod-required vars (`NODE_ENV`, `PORT`, `ALLOWED_ORIGINS`, `FRONTEND_URL`, Firebase) fail fast at startup |
| 9 | `backend/src/app.controller.ts` | Modify | `/health` actually pings the DB so Cloud Run marks unhealthy when Postgres is down |
| 10 | `backend/.env.example` | Modify | New deploy vars are documented for the next operator |
| 11 | `frontend/.env.example` | Modify | Firebase vars uncommented — Vercel reviewer sees what's required |
| 12 | `scripts/migrations.sh` | Create | Developers run migrations against dev/prod with one command |
| 13 | `README.md` | Modify | Deployment runbook (Neon → Cloud Run → Vercel) lives in the repo |

---

## 1. Blockers — must land before first deploy

### Backend container
- [ ] **Create `backend/Dockerfile`** — 2-stage Node 20 slim, non-root user, `CMD ["node","dist/main.js"]`. Reference: `stackpad/backend/Dockerfile`.
- [ ] **Create `backend/.dockerignore`** — exclude `node_modules`, `dist`, `.env*`, `*.sqlite`, `.git`, `coverage`.
- [ ] **Build locally** with `docker build -t daubert-be backend/` and run with `-e PORT=8080 -p 8080:8080` to confirm it boots.

### `backend/src/main.ts`
- [ ] Read `PORT` from env (default 8081 for local), bind `0.0.0.0` in production.
- [ ] Replace `app.enableCors()` with env-driven `ALLOWED_ORIGINS` allowlist + `credentials: true`.
- [ ] Add `app.use(helmet())`.
- [ ] Add `process.env.TZ = 'UTC'` at top of file.
- [ ] Add `pg.types.setTypeParser(1114, ...)` for UTC timestamp parsing (in `database.config.ts` is fine too).
- [ ] Set `forbidNonWhitelisted: true` on `ValidationPipe`.
- [ ] Register `SIGTERM` graceful shutdown (Cloud Run sends it during deploys).
- [ ] Register `unhandledRejection` / `uncaughtException` handlers.
- [ ] Add a global exception filter so stack traces don't leak in prod responses.

### Database / Neon
- [ ] In `backend/src/config/database.config.ts`:
  - [ ] Add `ssl: isProduction ? { rejectUnauthorized: false } : false`.
  - [ ] Set `synchronize: !isProduction`.
  - [ ] Replace `autoLoadEntities: true` with an explicit `entities: [...]` array (required by the CLI data source anyway).
- [ ] **Create `backend/src/database/cli-data-source.ts`** — exports a `DataSource` for TypeORM CLI.
- [ ] **Create `backend/src/database/migrations/`** + add a `0000_initial.ts` migration generated from current entities.
- [ ] Add migration scripts to `backend/package.json`:
  - `migration:generate`, `migration:run`, `migration:revert`.
- [ ] **Create `scripts/migrations.sh`** to wrap dev/prod runs (port from stackpad).
- [ ] Provision the Neon project + roles (owner / app / viewer) and capture the three URLs in 1Password (or wherever secrets live).
- [ ] Run `migration:run` against Neon once before first backend deploy.

### Env validation (`backend/src/config/env.validation.ts`)
- [ ] Make Firebase vars **hard-required** when `NODE_ENV=production` (currently warn-only).
- [ ] Add `NODE_ENV`, `PORT`, `ALLOWED_ORIGINS`, `FRONTEND_URL` to required list (prod only).
- [ ] Confirm `ConfigModule` doesn't throw when `.env.production` file is absent — Cloud Run injects via env, not file.

### Cloud Run service config
- [ ] Set env vars in the service: `NODE_ENV=production`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `ALLOWED_ORIGINS`, `FRONTEND_URL`.
- [ ] Min instances = 0 (or 1 if cold start matters), CPU = 1, memory = 512Mi to start.
- [ ] Confirm request timeout is enough for AI streaming endpoints.
- [ ] Confirm body size limits — backend allows 50MB (`main.ts:11`), Cloud Run HTTP/1 caps at 32MB; align expectations or move large uploads off-path.

### Frontend / Vercel
- [ ] Vercel project: set `NEXT_PUBLIC_API_URL` to the Cloud Run URL.
- [ ] Set every `NEXT_PUBLIC_FIREBASE_*` var (currently commented out in `.env.example`).
- [ ] Uncomment Firebase block in `frontend/.env.example` so the next deployer sees the requirement.
- [ ] Confirm root directory in Vercel project is `frontend/` and build command is default `next build`.

---

## 2. Should-fix before announcing

- [ ] **`/health` pings the DB** — currently returns `{status:'ok'}` without checking Postgres, so Cloud Run will keep a broken instance live.
- [ ] Structured logging (pino or similar) so Cloud Logging is greppable.
- [ ] Sentry (or equivalent) for backend + frontend error reporting.
- [ ] GitHub Actions: typecheck + build on PR for both `frontend/` and `backend/`.
- [ ] Rotate the Firebase private key + Anthropic/Etherscan/Tronscan keys currently sitting in `backend/.env.development`. They're gitignored, but they're prod-grade secrets in a dev file — split dev vs prod credentials cleanly before sharing the repo more widely.

---

## 3. Nice-to-have

- [ ] Cloud Run min-instances tuning once we see real traffic.
- [ ] CDN/cache headers on the Next.js app where appropriate.
- [ ] Backup policy on Neon (PITR window, restore drill).
- [ ] Rate limiting on auth endpoints.

---

## Suggested execution order

1. Backend container + `main.ts` hardening (steps 1–3 above) — own PR.
2. Database: SSL + `synchronize: false` + migrations setup + first migration against Neon — own PR.
3. Env validation tightening + `/health` DB ping — own PR.
4. Cloud Run deploy + smoke test against the service URL.
5. Vercel env vars + deploy, point `NEXT_PUBLIC_API_URL` at Cloud Run.
6. End-to-end smoke (login → create case → run trace → AI chat).
7. Custom domain + DNS, then quietly start sharing.
