# Daubert

## Plans

All plans in `docs/plans/` MUST include an **Atomized Changes** table at the top (before any task details).
This table list the main USER FACING or DEVELOPER FACING changes that the plan will bring. Not just file changes, but primarily what this will unlock

Example format:

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/foo/foo.service.ts` | Modify | Users can now do XYZ |
| 2 | `frontend/src/components/Bar.tsx` | Create | New component for Y |
| 3 | `backend/src/modules/old/old.service.ts` | Delete | Replaced by foo module |

### What changes (UX and DX)

**For the developer (DX):**
- Before starting any plan, you know exactly which files will be created, modified, or deleted — no surprises mid-implementation.
- The table is reviewable before any code is written. Scope creep is visible immediately (if the table grows, the plan grew).
- Makes it easy to split work across sessions or agents — each row is an independent unit of work.

**For the user (UX):**
- Plans are auditable: you can glance at the table and know if the plan touches something it shouldn't.
- Easy to say "don't touch that file" or "you're missing this file" before work begins.
- The summary table acts as a progress checklist during execution.

## Database migrations

- **All migrations go through `./migrations.sh`. ALWAYS.** No exceptions — not for generation, not for application, not for "just this once" fixes.
  - Generate with `./migrations.sh [--dev|--prod] --generate <Name>`. Never call `npx typeorm migration:generate` directly.
  - Apply with `./migrations.sh --prod --run`. Never run `migration:run` directly, and never apply schema changes via ad-hoc `psql` against prod.
  - Why this rule is hard: bypassing the script (e.g., copying data with explicit ids, or inserting into the `migrations` table by hand) leaves Postgres `SERIAL` sequences out of sync with the row data. The next time TypeORM runs a migration and asks the sequence for the next id, it gets a value that already exists, and the migration fails with `duplicate key value violates unique constraint` on commit. Recovery requires a one-off `setval(pg_get_serial_sequence(...), MAX(id))` per affected table — easy to fix once you know the symptom, but completely avoidable if every change flows through `./migrations.sh`.
- **Never apply migrations.** The user runs `./migrations.sh --prod --run` themselves. Generate the file, leave it for review.
- Dev does not need migrations applied — `synchronize: true` in dev auto-syncs the schema from entities. Migrations are a prod-only artifact. **Exception:** if a schema change requires a data backfill that `synchronize` can't do (e.g., adding a NOT NULL column to a non-empty table), apply a one-shot SQL block on dev that mirrors the migration's `up()` — but the migration file itself is still the source of truth for prod.

## Making changes
If you find an architectural issue, NEVER patch it with a "short term fix to get the user unstuck". Always flag it and discuss the deep, REAL fix.