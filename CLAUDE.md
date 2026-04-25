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

- Migrations are created **only** with `./migrations.sh` (never via raw `typeorm` invocations or one-off SQL).
- **Never apply migrations.** The user runs `./migrations.sh --prod --run` themselves. Generate the file, leave it for review.
- Dev does not need migrations applied — `synchronize: true` in dev auto-syncs the schema from entities. Migrations are a prod-only artifact.
