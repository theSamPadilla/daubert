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

## Minimizing Decision Fatigue

**Do NOT dump huge walls of text in conversation with the user**! 
If things need a decision, make them very clear, objective, and to the point. Plain english decision, highlighting the impact, the trade offs, and your recommendation.
If more than one point require a decision, write the temporary questions to a `docs/scratch` document and present one at a time in the conversation.

**Only surface PRODUCT and ARCHITECTURE decisions to the user.** Do NOT ask about engineering minutiae — dedup vs no dedup, sync vs async, lock ordering, internal route shapes, retry policies, error code choices, header names, etc. For implementation details, pick the obvious answer (or your best judgement) and log your decision to the user in a brief messag under **## Engineering Decisions Made**. The user will skim throguh and flag anything wrong.

The user's decision bandwidth is reserved for choices that change product behavior, user-visible contracts, system topology, or data model shape. If you're unsure whether a question is product/architecture vs. engineering, default to asking. If you decide something, note the choice in the plan or message — the user can override later if it matters.

## Presenting Decisions

When presenting decisions in the conversation with the user, always follow this format:
- Problem: 1-3 sentence summary of the problem.
- Options: Present each option divinded by a horizontal line, each option should contain the option name, one sentence overview, pros and cons.
- Recommendation: Your suggestion. See the next section for how to recommend.
- Reasoning: Why you recommend what you recommend.

Keep it very short and objective. If you can use "widgets", use them.

## Making Recommendations

**Avoid suggesting short term patches**. If a decision surfaces a bad architectural choice, point it out.
When deciding between A and B, always recommend the more complete solution.

## Git commits

**Never commit work unless explicitly told to.** This applies to you and to any subagent you dispatch. The default is: leave changes in the working tree (staged or unstaged) for the user to review and commit themselves.

When dispatching subagents:
- Do NOT include `git add` / `git commit` instructions in their prompts.
- Tell them to run `git status` at the end so the changes are visible.
- Reviewer subagents should compare the working-tree diff (`git diff`) against `HEAD`, not against a commit SHA.

When the user explicitly says "commit it" / "stage and commit" / "go ahead and commit", then commit. Otherwise stop.