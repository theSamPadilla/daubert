# Built-in Data Room (GCS) Implementation Plan

**Goal:** Replace the per-case Google-Drive-OAuth data room with a first-party, backend-brokered Google Cloud Storage data room that every case has by default, with a per-user access log for chain-of-custody.

## Summary
- **What & why:** The current data room uses Google's restricted `drive` OAuth scope, which is blocked behind a CASA security audit we can't complete — so the app is stuck in testing mode (≤100 users) and can't onboard customers. This rips out OAuth entirely and makes a GCS-backed room the default spine: zero setup, files always work, every read/write/delete brokered through our backend and logged. Bring-your-own-cloud (Drive `drive.file`, Microsoft Graph) is deferred to `docs/plans/extensions.md` behind a `StorageProvider` interface.
- **Key product decisions:**
  - Built-in GCS is the **default**, not a fallback. There is no "connect" step, no folder picker, no OAuth, no broken state. A case's data room just exists.
  - **Every file access is brokered through the backend** (no public objects, no presigned URLs) and writes a `data_room_access_log` row (`upload`/`download`/`delete`). Listing is not logged (metadata only).
  - **Roles preserved from existing code:** read (list/download) = `viewer`+; write (upload/delete) = `editor`+. (Existing code gates writes at `editor`, not `owner` — we keep that.)
  - Object layout: `org/<orgId>/case/<caseId>/<fileId>`.
  - **Storage driver:** GCS in prod via Application Default Credentials (Workload Identity on Cloud Run — **no static keys**). In non-prod, a local-disk provider is used automatically when no GCS bucket is configured, so local dev + QA work without GCP creds.
- **Load-bearing architecture decisions:**
  - A `StorageProvider` interface (`upload`/`download`/`delete` by object key) decouples the data room from the backend. GCS + LocalDisk are the two MVP impls; future providers are additive.
  - File metadata is the source of truth in a new `data_room_files` table (name, mime, size, objectKey, uploadedBy). Listing queries the table, never the bucket.
- **Risk concentration (opus tasks):** Task 1 (storage providers + streaming), Task 3 (service rewrite — objectKey/orgId, access logging, role enforcement).
- **Operator action — migration (NOT done by this run):** Dev works via `synchronize:true`. The prod migration is **left for the operator** to generate and run via `./migrations.sh --prod --generate AddBuiltInDataRoom` then `./migrations.sh --prod --run`. Autonomous generation is intentionally skipped: prod generation needs prod DB access this run must not use, and ad-hoc migration creation risks the SERIAL-sequence desync documented in `CLAUDE.md`. The migration must create `data_room_files` + `data_room_access_log` and drop `data_room_connections`.

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task. All work happens in the worktree `/Users/Sam/Work/Incite/dev/daubert/.worktrees/fullsend-built-in-data-room`. Commit per task on the `fullsend/built-in-data-room` branch. **No `Co-Authored-By` trailer.** Do NOT run `./migrations.sh` or apply any DB migration (see Operator action above). Do NOT push or open a PR.

## Atomized Change Table

| File | Action | What changes |
|---|---|---|
| `backend/package.json` | Modify | Add `@google-cloud/storage` dependency |
| `backend/src/modules/data-room/storage/storage-provider.interface.ts` | Create | `StorageProvider` interface + `STORAGE_PROVIDER` DI token |
| `backend/src/modules/data-room/storage/gcs-storage.provider.ts` | Create | GCS impl (ADC auth, streaming upload/download/delete) |
| `backend/src/modules/data-room/storage/local-disk-storage.provider.ts` | Create | Local-disk impl for non-prod/QA (temp dir) |
| `backend/src/modules/data-room/storage/storage.factory.ts` | Create | Picks GCS vs LocalDisk from env |
| `backend/src/modules/data-room/storage/local-disk-storage.provider.spec.ts` | Create | Round-trip test for local provider |
| `backend/src/modules/data-room/storage/gcs-storage.provider.spec.ts` | Create | GCS provider test (mocked `@google-cloud/storage`) |
| `backend/src/database/entities/data-room-file.entity.ts` | Create | `data_room_files` entity |
| `backend/src/database/entities/data-room-access-log.entity.ts` | Create | `data_room_access_log` entity |
| `backend/src/database/entities/data-room-connection.entity.ts` | Delete | OAuth connection model removed |
| `backend/src/database/entities/index.ts` | Modify | Register new entities, drop connection entity |
| `backend/src/database/entities/entities.spec.ts` | Create | Metadata assertions for new entities |
| `backend/src/modules/ai/ai.module.ts` | Modify | Swap `DataRoomConnectionEntity` for `DataRoomFileEntity` in `forFeature` |
| `backend/src/modules/ai/ai.service.ts` | Modify | Rebuild the AI `dataRoom` context from file count (room always exists) |
| `backend/src/modules/ai/ai.service.spec.ts` | Modify | Update mocked repo token to `DataRoomFileEntity` |
| `backend/src/modules/data-room/data-room.service.ts` | Modify | Full rewrite: list/upload/download/delete on `StorageProvider` + access log |
| `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Replace OAuth/HMAC tests with built-in-storage tests |
| `backend/src/modules/data-room/data-room.controller.ts` | Modify | Routes reduced to list/upload/download/delete; remove OAuth/connection routes |
| `backend/src/modules/data-room/data-room.controller.spec.ts` | Create | Controller route + role tests |
| `backend/src/modules/data-room/google-drive.service.ts` | Delete | OAuth Drive wrapper removed |
| `backend/src/modules/data-room/google-drive.service.spec.ts` | Delete | — |
| `backend/src/modules/data-room/encryption.service.ts` | Delete | No tokens to encrypt |
| `backend/src/modules/data-room/encryption.service.spec.ts` | Delete | — |
| `backend/src/modules/data-room/dto/set-folder.dto.ts` | Delete | No folder concept |
| `backend/src/modules/data-room/data-room.module.ts` | Modify | Wire new entities + storage provider; drop removed providers |
| `backend/src/config/env.validation.ts` | Modify | Remove `GOOGLE_OAUTH_*` + `DATAROOM_ENCRYPTION_KEY`; add `GCS_DATA_ROOM_BUCKET` (prod) + optional driver var |
| `backend/src/config/env.validation.spec.ts` | Create | Assert new var rules |
| `contracts/paths/data-room.yaml` | Modify | Reduce to file CRUD operations |
| `contracts/schemas/data-room.yaml` | Modify | Drop connection/folder/token DTOs; update `DataRoomFile` |
| `backend/src/generated/api-types.ts` | Modify (gen) | Regenerated via `npm run gen` |
| `frontend/src/generated/api-types.ts` | Modify (gen) | Regenerated via `npm run gen` |
| `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx` | Modify | Rewrite to file-list UI (no connect/picker/broken states) |
| `frontend/src/lib/api-client.ts` | Modify | Remove OAuth methods; add `dataRoomDeleteFile`; update `DataRoomFile` |
| `frontend/src/lib/google-picker.ts` | Delete | No picker |
| `docs/data-room.md` | Modify | Document the built-in GCS model |

---

## Task 1: Storage provider interface + GCS and LocalDisk implementations
**Implementer:** opus  ·  (streaming + GCS SDK mocking is fiddly and load-bearing)
**Files:**
- Create `backend/src/modules/data-room/storage/storage-provider.interface.ts`
- Create `backend/src/modules/data-room/storage/local-disk-storage.provider.ts`
- Create `backend/src/modules/data-room/storage/gcs-storage.provider.ts`
- Create `backend/src/modules/data-room/storage/storage.factory.ts`
- Test `backend/src/modules/data-room/storage/local-disk-storage.provider.spec.ts`
- Test `backend/src/modules/data-room/storage/gcs-storage.provider.spec.ts`
- Modify `backend/package.json` (add dep)

First add the dependency: `npm install @google-cloud/storage --prefix backend` (run from worktree root). Leave `googleapis` installed (used by a pending agent-drive-tools plan; do not remove).

**Step 1 — interface (`storage-provider.interface.ts`):**
```ts
import { Readable } from 'stream';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  /** Streams `body` to `objectKey`. Returns the number of bytes written. */
  upload(objectKey: string, body: Readable, contentType: string): Promise<{ size: number }>;
  /** Opens a read stream for `objectKey`. `size` is the object size in bytes if known. */
  download(objectKey: string): Promise<{ stream: Readable; size?: number }>;
  /** Deletes `objectKey`. Idempotent — never throws if the object is absent. */
  delete(objectKey: string): Promise<void>;
}
```

**Step 2 — LocalDisk provider (`local-disk-storage.provider.ts`):** writes under a base dir (default `path.join(os.tmpdir(), 'daubert-data-room')`, override `DATA_ROOM_LOCAL_DIR`). Object key path segments are joined under the base dir; create parent dirs on write. Count bytes via a counter on the write stream. `download` returns `fs.createReadStream` + `statSync().size`. `delete` uses `fs.promises.rm(p, { force: true })` (no throw if missing). Reject any objectKey containing `..` to prevent path traversal.

**Step 2 (test) — `local-disk-storage.provider.spec.ts`:** complete test:
```ts
import { LocalDiskStorageProvider } from './local-disk-storage.provider';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => res(Buffer.concat(chunks)));
    stream.on('error', rej);
  });
}

describe('LocalDiskStorageProvider', () => {
  const base = path.join(os.tmpdir(), `dr-test-${Date.now()}`);
  const provider = new LocalDiskStorageProvider(base);
  const key = 'org/o1/case/c1/f1';

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it('uploads, reports byte size, downloads identical bytes, deletes', async () => {
    const payload = Buffer.from('hello data room');
    const { size } = await provider.upload(key, Readable.from(payload), 'text/plain');
    expect(size).toBe(payload.length);

    const { stream, size: dlSize } = await provider.download(key);
    expect(dlSize).toBe(payload.length);
    expect((await collect(stream)).equals(payload)).toBe(true);

    await provider.delete(key);
    await expect(provider.download(key)).rejects.toBeDefined();
  });

  it('delete is idempotent on a missing key', async () => {
    await expect(provider.delete('org/o1/case/c1/missing')).resolves.toBeUndefined();
  });

  it('rejects path traversal keys', async () => {
    await expect(provider.upload('../escape', Readable.from(Buffer.from('x')), 'text/plain')).rejects.toBeDefined();
  });
});
```

**Step 3 — GCS provider (`gcs-storage.provider.ts`):** wraps `@google-cloud/storage`. Constructor takes a bucket name; `new Storage()` (ADC — no explicit keys). `upload`: pipe `body` into `bucket.file(key).createWriteStream({ resumable: true, contentType })`, counting bytes; resolve on `finish`. `download`: `const file = bucket.file(key); const [meta] = await file.getMetadata(); return { stream: file.createReadStream(), size: Number(meta.size) }`. `delete`: `await bucket.file(key).delete({ ignoreNotFound: true })`.

**Step 3 (test) — `gcs-storage.provider.spec.ts`:** `jest.mock('@google-cloud/storage', ...)` with a fake `Storage` whose `bucket().file()` returns mock `createWriteStream` (a `PassThrough` that emits `finish`), `getMetadata` (`[{ size: '11' }]`), `createReadStream` (`Readable.from`), and `delete` (jest.fn). Assert: upload pipes and resolves with byte count; download returns the stream + numeric size; delete calls `file.delete({ ignoreNotFound: true })`.

**Step 4 — factory (`storage.factory.ts`):** exports a Nest provider object `{ provide: STORAGE_PROVIDER, useFactory: (config: ConfigService) => {...}, inject: [ConfigService] }`. Logic: if `GCS_DATA_ROOM_BUCKET` set → `new GcsStorageProvider(bucket)`; else if `NODE_ENV !== 'production'` → `new LocalDiskStorageProvider()`; else throw (`GCS_DATA_ROOM_BUCKET required in production`).

**Step 5 — run tests:** `npm test --prefix backend -- storage` → expect the storage specs green.
**Step 6 — commit:** `git add backend/package.json backend/package-lock.json backend/src/modules/data-room/storage && git commit -m "feat(data-room): add StorageProvider interface with GCS and local-disk impls"`

---

## Task 2: New entities (`data_room_files`, `data_room_access_log`); remove connection entity + fix its consumers
**Implementer:** sonnet
**Files:**
- Create `backend/src/database/entities/data-room-file.entity.ts`
- Create `backend/src/database/entities/data-room-access-log.entity.ts`
- Delete `backend/src/database/entities/data-room-connection.entity.ts`
- Modify `backend/src/database/entities/index.ts` (the `entities` array + exports)
- Modify `backend/src/modules/ai/ai.module.ts`, `backend/src/modules/ai/ai.service.ts`, `backend/src/modules/ai/ai.service.spec.ts`
- Test `backend/src/database/entities/entities.spec.ts`

> **Why the AI files are here:** `ai.service.ts` (line 9 import, lines 288-289 inject, lines 889-892 usage), `ai.module.ts` (lines 9, 32), and `ai.service.spec.ts` (lines 14, 32, 79, 286, 385) all reference `DataRoomConnectionEntity`. Deleting the entity without fixing them breaks the backend build. This task must end build-green, so the consumer fix lives here.

**Step 1 — `data-room-file.entity.ts`** (extends `BaseEntity`; table `data_room_files`):
```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('data_room_files')
export class DataRoomFileEntity extends BaseEntity {
  @Index()
  @Column({ name: 'case_id' })
  caseId: string;

  @Column()
  name: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'bigint' }) // bytes; TypeORM returns bigint as string
  size: string;

  @Index({ unique: true })
  @Column({ name: 'object_key' })
  objectKey: string;

  @Column({ name: 'uploaded_by_user_id' })
  uploadedByUserId: string;
}
```

**Step 2 — `data-room-access-log.entity.ts`** (table `data_room_access_log`):
```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type DataRoomAction = 'upload' | 'download' | 'delete';

@Entity('data_room_access_log')
export class DataRoomAccessLogEntity extends BaseEntity {
  @Index()
  @Column({ name: 'case_id' })
  caseId: string;

  @Column({ name: 'file_id', type: 'varchar', nullable: true }) // nullable so deleting a file keeps the audit row
  fileId: string | null;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar' })
  action: DataRoomAction;
}
```

**Step 3 — `index.ts`:** remove the `DataRoomConnectionEntity` import/export and its entry in the `entities` array; add imports + exports + array entries for the two new entities. Then delete `data-room-connection.entity.ts`.

**Step 4 (test) — `entities.spec.ts`:** use `getMetadataArgsStorage()` to assert both new entity classes map to the expected table names and that `data_room_files` has a unique index on `object_key`. Example:
```ts
import { getMetadataArgsStorage } from 'typeorm';
import { DataRoomFileEntity } from './data-room-file.entity';
import { DataRoomAccessLogEntity } from './data-room-access-log.entity';

describe('data room entities', () => {
  const tables = getMetadataArgsStorage().tables;
  it('map to expected tables', () => {
    expect(tables.find((t) => t.target === DataRoomFileEntity)?.name).toBe('data_room_files');
    expect(tables.find((t) => t.target === DataRoomAccessLogEntity)?.name).toBe('data_room_access_log');
  });
});
```

**Step 5 — fix the AI consumers** (do this in the same task so the build stays green):
- `ai.module.ts`: replace the `DataRoomConnectionEntity` import + its `forFeature` entry with `DataRoomFileEntity`.
- `ai.service.ts`: replace the import (line 9), the injected repo (lines 288-289 → `@InjectRepository(DataRoomFileEntity) private readonly dataRoomFileRepo: Repository<DataRoomFileEntity>`), and the context block (lines 889-892) with a file-count context — the room always exists now:
  ```ts
  const fileCount = await this.dataRoomFileRepo.count({ where: { caseId } });
  const dataRoom = { available: true, fileCount };
  ```
- `ai.service.spec.ts`: change the mocked repo token from `DataRoomConnectionEntity` to `DataRoomFileEntity` (lines 14, 79, 286, 385) and give the mock a `count: jest.fn().mockResolvedValue(0)` (line 32) instead of/in addition to `find`.

**Step 6 — run:** `npm test --prefix backend -- entities ai.service` and `npm run build --prefix backend` → all green (no dangling `DataRoomConnectionEntity` imports).
**Step 7 — commit:** `git add backend/src/database/entities backend/src/modules/ai && git commit -m "feat(data-room): add file + access-log entities, migrate AI context off connection entity"`

---

## Task 3: Rewrite `DataRoomService` for built-in storage
**Implementer:** opus  ·  (objectKey/orgId derivation, access logging, role enforcement — core logic, high blast radius)
**Files:**
- Modify `backend/src/modules/data-room/data-room.service.ts` (full rewrite)
- Modify `backend/src/modules/data-room/data-room.service.spec.ts` (replace tests)

Inject: `@InjectRepository(DataRoomFileEntity)`, `@InjectRepository(DataRoomAccessLogEntity)`, `@InjectRepository(CaseEntity)`, and `@Inject(STORAGE_PROVIDER) storage: StorageProvider`. Read the real `CaseEntity` to confirm the org field — it is `orgId` (column `organization_id`).

**Public API (replace everything OAuth-related):**
- `listFiles(caseId): Promise<DataRoomFileDto[]>` — `find({ where: { caseId }, order: { createdAt: 'DESC' } })`, map to DTO (`{ id, name, mimeType, size, uploadedByUserId, createdAt }`). Not logged.
- `uploadFromStream(caseId, userId, name, mimeType, body): Promise<DataRoomFileDto>` — generate `const id = crypto.randomUUID()`; resolve `orgId` via case repo (`findOneByOrThrow`); `objectKey = \`org/${orgId}/case/${caseId}/${id}\``; `const { size } = await storage.upload(objectKey, body, mimeType)`; save `DataRoomFileEntity` with explicit `id`; write access-log row (`action: 'upload'`, `fileId: id`); return DTO.
- `getFileForDownload(caseId, userId, fileId): Promise<{ stream, name, mimeType, size }>` — load file row scoped by `{ id: fileId, caseId }` (404 if absent); `storage.download(row.objectKey)`; write access-log (`download`); return stream + metadata.
- `deleteFile(caseId, userId, fileId): Promise<void>` — load row scoped by `{ id, caseId }` (404 if absent); `storage.delete(row.objectKey)`; remove the row; write access-log (`delete`).
- Keep `static requireWriteAccess(role)` (throws `ForbiddenException` for `viewer`).

Remove: all HMAC state, `getAuthUrl`, `handleCallback`, `getConnection`, `setFolder`, `getAccessToken`, `disconnect`, refresh-token dedup Map, `withFreshTokens`, encryption usage.

**Access-log helper:** a private `log(caseId, userId, action, fileId)` that inserts a row; never let a logging failure abort the main operation’s success path *after* the storage mutation — but DO write the log before returning. (Engineering detail: log synchronously in the same async flow; if the insert throws, let it propagate for upload/delete since the audit record is part of the custody guarantee.)

**Step 1 (test) — rewrite `data-room.service.spec.ts`** using `Test.createTestingModule` with mocked repos + a mock `StorageProvider` + mock case repo. Cover:
- `uploadFromStream` builds objectKey `org/<orgId>/case/<caseId>/<id>`, calls `storage.upload`, saves a file row with that key + `uploadedByUserId`, and inserts an access-log row with `action:'upload'`.
- `getFileForDownload` throws `NotFoundException` when no row matches `{id, caseId}`; on success calls `storage.download` and logs `download`.
- `deleteFile` calls `storage.delete`, removes the row, logs `delete`; 404 when missing.
- cross-case isolation: a file row whose `caseId` differs is treated as not found.
Example assertion for upload:
```ts
caseRepo.findOneByOrFail.mockResolvedValue({ id: 'c1', orgId: 'o1' });
storage.upload.mockResolvedValue({ size: 11 });
fileRepo.save.mockImplementation(async (e) => e);
await service.uploadFromStream('c1', 'u1', 'a.pdf', 'application/pdf', Readable.from('hello data'));
expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(/^org\/o1\/case\/c1\/[0-9a-f-]{36}$/), expect.anything(), 'application/pdf');
expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'c1', userId: 'u1', action: 'upload' }));
```

**Step 2 — run, confirm fail:** `npm test --prefix backend -- data-room.service` (fails: methods don't exist yet).
**Step 3 — implement** the service as specified.
**Step 4 — run, confirm pass:** same command → green.
**Step 5 — commit:** `git add backend/src/modules/data-room/data-room.service.ts backend/src/modules/data-room/data-room.service.spec.ts && git commit -m "feat(data-room): rewrite service on StorageProvider with access logging"`

---

## Task 4: Rewrite `DataRoomController`
**Implementer:** sonnet
**Files:**
- Modify `backend/src/modules/data-room/data-room.controller.ts`
- Test `backend/src/modules/data-room/data-room.controller.spec.ts` (create)

**Routes (final set):**
| Method | Path | Guard | Handler |
|---|---|---|---|
| GET | `cases/:caseId/data-room/files` | `@RequireRole('viewer')` | `service.listFiles(caseId)` |
| POST | `cases/:caseId/data-room/files` | `@RequireRole('editor')` | busboy stream → `service.uploadFromStream(caseId, userId, ...)` |
| GET | `cases/:caseId/data-room/files/:fileId/download` | `@RequireRole('viewer')` | `service.getFileForDownload` → `StreamableFile` |
| DELETE | `cases/:caseId/data-room/files/:fileId` | `@RequireRole('editor')`, `@HttpCode(204)` | `service.deleteFile` |

Reuse the existing busboy block (50MB cap, `safeRespond`, `limits.files:1`) and the existing `StreamableFile` + `contentDisposition` download block verbatim — only swap the service calls and pass `userId = req.user.id`. **Use `req.user.id` (the DB UUID set by `auth.guard.ts` and read as `user.id` in `role.guard.ts`), NOT `req.user.uid` (that's the Firebase UID — using it would corrupt the access-log `userId`).** Remove the connect/oauth-callback/connection-GET/folder-PATCH/access-token/connection-DELETE routes.

**Step 1 (test):** controller spec with a mocked `DataRoomService`; assert each handler delegates correctly and that upload wires busboy to `uploadFromStream`. (Role decorators are metadata — assert via `Reflector` that `files` GET requires `viewer` and `POST`/`DELETE` require `editor`.)
**Step 2–4:** run `npm test --prefix backend -- data-room.controller` (fail → implement → pass).
**Step 5 — commit:** `git add backend/src/modules/data-room/data-room.controller.ts backend/src/modules/data-room/data-room.controller.spec.ts && git commit -m "feat(data-room): reduce controller to file CRUD"`

---

## Task 5: Module wiring + delete dead files
**Implementer:** sonnet
**Files:**
- Modify `backend/src/modules/data-room/data-room.module.ts`
- Delete `backend/src/modules/data-room/google-drive.service.ts` + `.spec.ts`
- Delete `backend/src/modules/data-room/encryption.service.ts` + `.spec.ts`
- Delete `backend/src/modules/data-room/dto/set-folder.dto.ts`

**Module:** `TypeOrmModule.forFeature([DataRoomFileEntity, DataRoomAccessLogEntity, CaseEntity])`, keep `AuthModule`. Providers: `DataRoomService` + the `storageProviderFactory` (from `storage.factory.ts`). Remove `GoogleDriveService` and `EncryptionService` providers. Keep `exports: [DataRoomService]`.

**Step 1 — delete the four service/dto files + their specs.**
**Step 2 — update the module.**
**Step 3 — run:** `npm test --prefix backend -- data-room` and `npm run build --prefix backend` → both green (no dangling imports).
**Step 4 — commit:** `git add -A backend/src/modules/data-room && git commit -m "refactor(data-room): wire built-in storage module, remove OAuth services"`

---

## Task 6: Env validation
**Implementer:** sonnet
**Files:**
- Modify `backend/src/config/env.validation.ts`
- Create `backend/src/config/env.validation.spec.ts` (does not exist yet)

Remove `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `DATAROOM_ENCRYPTION_KEY` from `requiredEnvVars` and delete the `DATAROOM_ENCRYPTION_KEY` hex-format check block. **Keep `FRONTEND_URL`** (used by `email.service.ts`). Add validation: require `GCS_DATA_ROOM_BUCKET` only when `NODE_ENV === 'production'`. Optional `DATA_ROOM_LOCAL_DIR` needs no validation.

**Step 1 (test):** prod env without `GCS_DATA_ROOM_BUCKET` throws; prod env with it passes; non-prod without it passes; OAuth/encryption vars are no longer required (absent → no throw).
**Step 2–4:** `npm test --prefix backend -- env.validation` (fail → implement → pass).
**Step 5 — commit:** `git add backend/src/config/env.validation.ts backend/src/config/env.validation.spec.ts && git commit -m "feat(config): swap data-room OAuth env vars for GCS bucket"`

---

## Task 7: Contracts + codegen
**Implementer:** sonnet
**Files:**
- Modify `contracts/paths/data-room.yaml`
- Modify `contracts/schemas/data-room.yaml`
- Regenerate `backend/src/generated/api-types.ts` + `frontend/src/generated/api-types.ts`

**paths:** keep only `GET/POST /cases/{caseId}/data-room/files`, `GET .../files/{fileId}/download`, and add `DELETE .../files/{fileId}` (204). Remove connect, oauth-callback, connection GET, folder PATCH, access-token, connection DELETE.
**schemas:** remove `DataRoomStatus`, `DataRoomConnection`, `ConnectInitResponse`, `SetFolderRequest`, `AccessTokenResponse`. Update `DataRoomFile` to `{ id, name, mimeType, size (string), uploadedByUserId, createdAt }`.

**Step 1 — edit the two yaml files.**
**Step 2 — regen + typecheck:** `npm run gen` (repo root) then `npm run build --prefix backend` and `npm run build --prefix frontend` (frontend build may surface only after Task 8 — if it errors solely on `page.tsx`/`api-client.ts`, that's expected and resolved in Task 8; backend build must be green here).
**Step 3 — commit:** `git add contracts backend/src/generated/api-types.ts frontend/src/generated/api-types.ts && git commit -m "feat(contracts): data-room file CRUD schema"`

---

## Task 8: Frontend rewrite
**Implementer:** sonnet
**Files:**
- Modify `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx`
- Modify `frontend/src/lib/api-client.ts`
- Delete `frontend/src/lib/google-picker.ts`

**api-client.ts:** remove `dataRoomConnect`, `dataRoomGet`, `dataRoomSetFolder`, `dataRoomGetAccessToken`, `dataRoomDisconnect`. Add `dataRoomDeleteFile(caseId, fileId): Promise<void>` (DELETE `/cases/:caseId/data-room/files/:fileId`). Keep `dataRoomListFiles`, `dataRoomDownload`, `dataRoomUpload`. Update the inline `DataRoomFile` interface to `{ id, name, mimeType, size, uploadedByUserId, createdAt }`; remove the `DataRoomConnection` interface.

**page.tsx:** collapse to two states — `loading` then `loaded`. On mount call `dataRoomListFiles`. Render the file table (name, size, uploaded date). For `canMutate` (`owner`/`editor`): show an upload control (reuse the existing hidden `<input type=file>` + progress bar via `dataRoomUpload`) and a per-row delete button (calls `dataRoomDeleteFile`, then refreshes the list). Viewers see list + download only. Remove all connect/disconnect/change-folder/picker/broken UI, the `PickerNotConfiguredBanner`, and the `NEXT_PUBLIC_DRIVE_PICKER_KEY` reference. Empty list shows a simple "No files yet" state with the upload control for editors.

**Step 1 (test):** the frontend has RTL + jsdom set up — add a co-located `page.spec.tsx` test: mock `api-client`; assert the table renders returned files, the delete button calls `dataRoomDeleteFile` for editors, and the upload/delete controls are hidden for a `viewer`.
**Step 2–4:** `npm test --prefix frontend` then `npm run build --prefix frontend` → green.
**Step 5 — commit:** `git add -A frontend/src && git commit -m "feat(data-room): file-list UI on built-in storage"`

---

## Task 9: Docs
**Implementer:** sonnet
**Files:** Modify `docs/data-room.md`

Rewrite to describe: built-in GCS model, no OAuth/connection, the `StorageProvider` interface (GCS prod via Workload Identity / local-disk dev), object layout `org/<orgId>/case/<caseId>/<fileId>`, the `data_room_files` + `data_room_access_log` tables, backend-brokered access + access logging, the reduced endpoint set, env vars (`GCS_DATA_ROOM_BUCKET`, optional `DATA_ROOM_LOCAL_DIR`), and a note pointing to `docs/plans/extensions.md` for BYO-cloud. Add the **operator migration note** (generate via `./migrations.sh --prod --generate AddBuiltInDataRoom`, then `--run`).

**Step — commit:** `git add docs/data-room.md && git commit -m "docs: built-in data room"`

---

## Done criteria
- `npm test --prefix backend` and `npm run build --prefix backend` green.
- `npm test --prefix frontend` and `npm run build --prefix frontend` green.
- No remaining references to OAuth/Picker/`DataRoomConnection`/`EncryptionService` (`grep -rn "google-picker\|DataRoomConnection\|EncryptionService\|oauth-callback" backend/src frontend/src` returns nothing).
- The data room page lists, uploads, downloads, and deletes against the configured provider (local-disk in dev/QA).
- Prod migration is NOT created by this run — left for the operator per the Summary.
