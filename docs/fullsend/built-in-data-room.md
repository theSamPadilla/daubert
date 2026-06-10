# Fullsend: built-in-data-room
Base branch: dev
Worktree: .worktrees/fullsend-built-in-data-room   Branch: fullsend/built-in-data-room
Source: docs/ideas/built-in-data-room.md

- [x] plan    → docs/plans/2026-06-10-built-in-data-room.md (auto-review: ready, 2 rounds)
- [x] execute → 11 commits on branch; 641 backend tests + 99 frontend tests green; both builds clean; opus final review applied 3 fixes (delete ordering, dead requireWriteAccess, AI skill doc)
- [x] qa     → browser-tested on worktree (ports 3002/8082, local-disk storage). Sam did the Google login. Verified list/upload/download/delete end-to-end; objectKey layout org/<orgId>/case/<caseId>/<fileId> on disk; access log shows upload+download+delete by DB user id; list not logged. Caught + fixed a (pre-existing) busboy import bug that 500'd uploads.
- [x] merge  → fast-forwarded dev to d488928 (local, no push). Worktree removed, branch fullsend/built-in-data-room deleted (merged). RUN COMPLETE.

## Decision log
- 2026-06-10: Branching — operator explicitly chose fullsend's worktree isolation over the standing "no new branches" rule (asked because the two collided). Worktree on fullsend/built-in-data-room off dev; merges to dev locally at the end, no push.
- 2026-06-10: Doc artifacts (idea doc, extensions.md, todo edit, service-account plan deletion) stay uncommitted on dev per operator intent; only the generated plan + implementation code live on the fullsend branch and merge back — avoids merge collisions with dev's uncommitted doc state.
- 2026-06-10 (plan): AI module consumed the deleted DataRoomConnectionEntity to build a `{connected, folderName, status}` context. Since the room now always exists, replaced it with `{available: true, fileCount}` from DataRoomFileEntity.count() — anchored on the idea doc's "room always exists" decision. Folded into Task 2 so the entity deletion leaves the build green.
- 2026-06-10 (plan): Roles kept at the EXISTING code's threshold (writes=editor+, reads=viewer+), not the stale docs/data-room.md "owner" claim — match implemented behavior.
- 2026-06-10 (plan): Prod migration deferred to operator (generate+run via ./migrations.sh) — autonomous generation needs prod DB access and risks the SERIAL-sequence desync documented in CLAUDE.md. Dev works via synchronize:true.
- 2026-06-10 (plan): Dev/QA without GCP creds use a LocalDisk StorageProvider (temp dir), selected automatically when GCS_DATA_ROOM_BUCKET is unset in non-prod — needed so QA can exercise upload/download.
- 2026-06-10 (exec Task 2): Implementer found the data-room module files (controller/service/module/spec) also imported the deleted connection entity, so it added a transient `_legacy-connection.type.ts` plain-class shim (no @Entity → no phantom table) to keep Task 2's build green. Deleted in Task 5; final opus review confirmed gone.
- 2026-06-10 (exec Task 8): Implementer found InvestigationsSidebar.tsx also showed connection status via the removed dataRoomGet; simplified it to a plain nav link (minor UX change — sidebar no longer shows a data-room connection badge, which is correct now that the room always exists).
- 2026-06-10 (exec final review): Reversed deleteFile ordering (remove DB row before storage object — DB is source of truth, storage delete is idempotent); deleted now-dead requireWriteAccess (its only caller, the removed access-token route, is gone — overrode the plan's "keep it" since it's genuinely unused); refreshed backend/src/skills/product-knowledge.md which still described the old Drive OAuth flow to the AI agent.
- 2026-06-10 (qa): Browser upload 500'd: `(0, busboy_1.default) is not a function`. Root cause = `import busboy from 'busboy'` with esModuleInterop OFF project-wide → emits `busboy_1.default` (undefined for busboy's `export =`). PRE-EXISTING (the original controller had the identical import; the old upload was broken too). Fixed with `import busboy = require('busboy')`. Re-verified full CRUD green. Commit d488928.
- 2026-06-10 (qa setup): Main-repo dev servers occupy 3001/8081, so ran the worktree on 3002/8082. A local ByCrux 'hub' backend binds *:8082, making localhost:8082 ambiguous (IPv4 daubert vs IPv6 hub) — pinned the frontend to http://127.0.0.1:8082 to force daubert. Copied gitignored .env.development + QA.md into the worktree (absent because branched off HEAD).
