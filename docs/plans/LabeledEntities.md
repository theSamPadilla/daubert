# LabeledEntities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global entity registry that maps known blockchain actors to wallet addresses, surfaced in the graph and accessible to the AI agent.

**Architecture:** New `LabeledEntitiesModule` in the NestJS backend with a TypeORM entity, CRUD controller (read=auth, CUD=admin), and a `query_labeled_entities` agent tool. Frontend gets a single `/entities` page that conditionally shows CUD controls for admin users, plus a Daubert Label badge in the node DetailsPanel. New OpenAPI contract files for type generation.

**Tech Stack:** NestJS, TypeORM, class-validator, Next.js App Router, React, existing Firebase auth + `IsAdminGuard`

**Notes:**
- Admin = `email.endsWith('@incite.ventures')` — same check on both backend (`IsAdminGuard` in `backend/src/modules/auth/admin.guard.ts`) and frontend. This relies on Firebase enforcing email verification; confirm this is configured.
- Dev auto-syncs the table (`synchronize: !isProduction`). Prod requires a generated migration — see Task 1.
- Search (ILIKE) and wallet lookup (JSONB scan) are unindexed. Fine pre-launch. Add GIN index on wallets and trigram index on name once there's real data volume.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/database/entities/labeled-entity.entity.ts` | Create | TypeORM entity for global labeled entities |
| 2 | `backend/src/database/entities/index.ts` | Modify | Register new entity |
| 3 | `contracts/schemas/labeled-entities.yaml` | Create | OpenAPI schema for LabeledEntity, Create/UpdateRequest |
| 4 | `contracts/paths/labeled-entities.yaml` | Create | OpenAPI path definitions for all endpoints |
| 5 | `contracts/openapi.yaml` | Modify | Add new paths and schema refs |
| 6 | `backend/src/modules/labeled-entities/dto/create-labeled-entity.dto.ts` | Create | Validated DTO for create |
| 7 | `backend/src/modules/labeled-entities/dto/update-labeled-entity.dto.ts` | Create | Validated DTO for update |
| 8 | `backend/src/modules/labeled-entities/labeled-entities.service.ts` | Create | Query logic, address lookup |
| 9 | `backend/src/modules/labeled-entities/labeled-entities.controller.ts` | Create | REST endpoints (read=auth, CUD=IsAdminGuard) |
| 10 | `backend/src/modules/labeled-entities/labeled-entities.module.ts` | Create | NestJS module |
| 11 | `backend/src/app.module.ts` | Modify | Import LabeledEntitiesModule |
| 12 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Add `QUERY_LABELED_ENTITIES_TOOL` definition |
| 13 | `backend/src/modules/ai/tools/index.ts` | Modify | Import, re-export, and push into `AGENT_TOOLS` |
| 14 | `backend/src/modules/ai/ai.service.ts` | Modify | Import tool, add case to `executeTool` switch, inject `LabeledEntitiesService` |
| 15 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `LabeledEntitiesModule` |
| 16 | `frontend/src/lib/api-client.ts` | Modify | Add labeled-entity API methods (temporary — regenerated in step 17) |
| 17 | Run `npm run gen` | — | Regenerate `api-types.ts` from updated OpenAPI contracts |
| 18 | `frontend/src/components/AdminGuard.tsx` | Create | Frontend guard — checks `@incite.ventures` email domain |
| 19 | `frontend/src/app/internal/layout.tsx` | Create | Admin layout wrapping `AdminGuard` |
| 20 | `frontend/src/app/entities/layout.tsx` | Create | Auth-protected layout |
| 21 | `frontend/src/app/entities/page.tsx` | Create | Entities page: read-only for all users, CUD controls shown conditionally for admins |
| 22 | `frontend/src/hooks/useLabeledEntities.ts` | Create | Hook to fetch + cache labeled entities, stale-while-revalidate |
| 23 | `frontend/src/components/DetailsPanel.tsx` | Modify | Surface Daubert Label badge on matched nodes |

---

### Task 1: Entity + Enum + Migration

**Files:**
- Create: `backend/src/database/entities/labeled-entity.entity.ts`
- Modify: `backend/src/database/entities/index.ts`

**Step 1: Create the entity with a typed enum for category**

```typescript
// backend/src/database/entities/labeled-entity.entity.ts
import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum EntityCategory {
  EXCHANGE = 'exchange',
  MIXER = 'mixer',
  BRIDGE = 'bridge',
  PROTOCOL = 'protocol',
  INDIVIDUAL = 'individual',
  CONTRACT = 'contract',
  GOVERNMENT = 'government',
  CUSTODIAN = 'custodian',
  OTHER = 'other',
}

@Entity('labeled_entities')
export class LabeledEntityEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'varchar' })
  category: EntityCategory;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  wallets: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
```

Note: `default: () => "'[]'::jsonb"` avoids the TypeORM footgun where `default: '[]'` causes spurious migration diffs on every generate.

**Step 2: Register in entity index**

In `backend/src/database/entities/index.ts`, add the import and include `LabeledEntityEntity` in the `entities` array:

```typescript
import { LabeledEntityEntity } from './labeled-entity.entity';

export const entities = [
  CaseEntity,
  CaseMemberEntity,
  ConversationEntity,
  InvestigationEntity,
  LabeledEntityEntity,
  MessageEntity,
  ScriptRunEntity,
  TraceEntity,
  UserEntity,
];
```

**Step 3: Run the backend in dev to verify auto-sync**

Run: `npm run be`
Expected: Backend starts without errors. The `labeled_entities` table is created automatically.

**Step 4: Generate the prod migration**

Run: `./scripts/migrations.sh --dev --generate AddLabeledEntities`
Expected: A new migration file in `backend/src/database/migrations/` with the CREATE TABLE statement.

Review the generated migration to make sure it only contains the `labeled_entities` table creation. Do NOT run it against prod yet — that happens at deploy time.

**Step 5: Commit**

```bash
git add backend/src/database/entities/labeled-entity.entity.ts backend/src/database/entities/index.ts backend/src/database/migrations/
git commit -m "feat: add LabeledEntity entity with category enum and migration"
```

---

### Task 2: OpenAPI Contracts

**Files:**
- Create: `contracts/schemas/labeled-entities.yaml`
- Create: `contracts/paths/labeled-entities.yaml`
- Modify: `contracts/openapi.yaml`

**Step 1: Create the schema file**

Follow the existing pattern from `contracts/schemas/traces.yaml`:

```yaml
# contracts/schemas/labeled-entities.yaml
EntityCategory:
  type: string
  enum:
    - exchange
    - mixer
    - bridge
    - protocol
    - individual
    - contract
    - government
    - custodian
    - other

LabeledEntity:
  type: object
  required: [id, name, category, wallets, createdAt, updatedAt]
  properties:
    id:
      type: string
      format: uuid
    name:
      type: string
    category:
      $ref: '#/EntityCategory'
    description:
      type: string
      nullable: true
    wallets:
      type: array
      items:
        type: string
    metadata:
      type: object
      nullable: true
      additionalProperties: true
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time

CreateLabeledEntityRequest:
  type: object
  required: [name, category, wallets]
  properties:
    name:
      type: string
    category:
      $ref: '#/EntityCategory'
    description:
      type: string
    wallets:
      type: array
      items:
        type: string
    metadata:
      type: object
      additionalProperties: true

UpdateLabeledEntityRequest:
  type: object
  properties:
    name:
      type: string
    category:
      $ref: '#/EntityCategory'
    description:
      type: string
    wallets:
      type: array
      items:
        type: string
    metadata:
      type: object
      additionalProperties: true
```

**Step 2: Create the paths file**

Follow the pattern from `contracts/paths/traces.yaml`:

```yaml
# contracts/paths/labeled-entities.yaml
/labeled-entities:
  get:
    summary: List labeled entities
    operationId: listLabeledEntities
    parameters:
      - name: category
        in: query
        schema:
          $ref: '../schemas/labeled-entities.yaml#/EntityCategory'
      - name: search
        in: query
        schema:
          type: string
    responses:
      '200':
        description: Array of labeled entities
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: '../schemas/labeled-entities.yaml#/LabeledEntity'
  post:
    summary: Create a labeled entity (admin only)
    operationId: createLabeledEntity
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '../schemas/labeled-entities.yaml#/CreateLabeledEntityRequest'
    responses:
      '201':
        description: Created labeled entity
        content:
          application/json:
            schema:
              $ref: '../schemas/labeled-entities.yaml#/LabeledEntity'

/labeled-entities/lookup:
  get:
    summary: Look up entities by wallet address
    operationId: lookupLabeledEntity
    parameters:
      - name: address
        in: query
        required: true
        schema:
          type: string
    responses:
      '200':
        description: Matching entities
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: '../schemas/labeled-entities.yaml#/LabeledEntity'

/labeled-entities/{id}:
  get:
    summary: Get a labeled entity
    operationId: getLabeledEntity
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '200':
        description: Labeled entity
        content:
          application/json:
            schema:
              $ref: '../schemas/labeled-entities.yaml#/LabeledEntity'
  patch:
    summary: Update a labeled entity (admin only)
    operationId: updateLabeledEntity
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '../schemas/labeled-entities.yaml#/UpdateLabeledEntityRequest'
    responses:
      '200':
        description: Updated labeled entity
        content:
          application/json:
            schema:
              $ref: '../schemas/labeled-entities.yaml#/LabeledEntity'
  delete:
    summary: Delete a labeled entity (admin only)
    operationId: deleteLabeledEntity
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '204':
        description: Deleted
```

**Step 3: Wire into openapi.yaml**

Add to the `paths:` section of `contracts/openapi.yaml`:

```yaml
  /labeled-entities:
    $ref: './paths/labeled-entities.yaml#/~1labeled-entities'
  /labeled-entities/lookup:
    $ref: './paths/labeled-entities.yaml#/~1labeled-entities~1lookup'
  /labeled-entities/{id}:
    $ref: './paths/labeled-entities.yaml#/~1labeled-entities~1{id}'
```

Add to the `components.schemas:` section:

```yaml
    EntityCategory:
      $ref: './schemas/labeled-entities.yaml#/EntityCategory'
    LabeledEntity:
      $ref: './schemas/labeled-entities.yaml#/LabeledEntity'
    CreateLabeledEntityRequest:
      $ref: './schemas/labeled-entities.yaml#/CreateLabeledEntityRequest'
    UpdateLabeledEntityRequest:
      $ref: './schemas/labeled-entities.yaml#/UpdateLabeledEntityRequest'
```

**Step 4: Regenerate types**

Run: `npm run gen`
Expected: `api-types.ts` in both frontend and backend are updated with the new types.

**Step 5: Commit**

```bash
git add contracts/ frontend/src/generated/ backend/src/generated/
git commit -m "feat: add LabeledEntity OpenAPI contracts and regenerate types"
```

---

### Task 3: DTOs

**Files:**
- Create: `backend/src/modules/labeled-entities/dto/create-labeled-entity.dto.ts`
- Create: `backend/src/modules/labeled-entities/dto/update-labeled-entity.dto.ts`

**Step 1: Create the Create DTO**

Wallets are normalized on insert: trimmed and lowercased (EVM addresses are case-insensitive; lowercasing avoids lookup mismatches from mixed-case checksummed addresses).

```typescript
// backend/src/modules/labeled-entities/dto/create-labeled-entity.dto.ts
import { IsString, IsEnum, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { EntityCategory } from '../../../database/entities/labeled-entity.entity';

export class CreateLabeledEntityDto {
  @IsString()
  name: string;

  @IsEnum(EntityCategory)
  category: EntityCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (value as string[]).map((w) => w.trim().toLowerCase()))
  wallets: string[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}
```

**Step 2: Create the Update DTO**

```typescript
// backend/src/modules/labeled-entities/dto/update-labeled-entity.dto.ts
import { IsString, IsEnum, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { EntityCategory } from '../../../database/entities/labeled-entity.entity';

export class UpdateLabeledEntityDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(EntityCategory)
  category?: EntityCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => value ? (value as string[]).map((w) => w.trim().toLowerCase()) : value)
  wallets?: string[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}
```

**Step 3: Commit**

```bash
git add backend/src/modules/labeled-entities/dto/
git commit -m "feat: add LabeledEntity DTOs with wallet normalization"
```

---

### Task 4: Service

**Files:**
- Create: `backend/src/modules/labeled-entities/labeled-entities.service.ts`

**Step 1: Create the service**

```typescript
// backend/src/modules/labeled-entities/labeled-entities.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LabeledEntityEntity, EntityCategory } from '../../database/entities/labeled-entity.entity';
import { CreateLabeledEntityDto } from './dto/create-labeled-entity.dto';
import { UpdateLabeledEntityDto } from './dto/update-labeled-entity.dto';

@Injectable()
export class LabeledEntitiesService {
  constructor(
    @InjectRepository(LabeledEntityEntity)
    private readonly repo: Repository<LabeledEntityEntity>,
  ) {}

  async findAll(filters?: { category?: EntityCategory; search?: string }) {
    const qb = this.repo.createQueryBuilder('e');

    if (filters?.category) {
      qb.andWhere('e.category = :category', { category: filters.category });
    }
    if (filters?.search) {
      qb.andWhere('e.name ILIKE :search', { search: `%${filters.search}%` });
    }

    qb.orderBy('e.name', 'ASC');
    return qb.getMany();
  }

  async findOne(id: string) {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException(`LabeledEntity ${id} not found`);
    return entity;
  }

  /**
   * Look up entities by wallet address.
   * Wallets are stored lowercased (normalized on insert via DTO transform).
   * Query lowercases the input for a case-insensitive match.
   */
  async lookupByAddress(address: string) {
    return this.repo
      .createQueryBuilder('e')
      .where(
        `EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.wallets) w WHERE w = LOWER(:address))`,
        { address: address.trim() },
      )
      .getMany();
  }

  async create(dto: CreateLabeledEntityDto) {
    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateLabeledEntityDto) {
    const entity = await this.findOne(id);
    Object.assign(entity, dto);
    return this.repo.save(entity);
  }

  async remove(id: string) {
    const entity = await this.findOne(id);
    await this.repo.remove(entity);
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/modules/labeled-entities/labeled-entities.service.ts
git commit -m "feat: add LabeledEntities service with address lookup"
```

---

### Task 5: Controller

**Files:**
- Create: `backend/src/modules/labeled-entities/labeled-entities.controller.ts`

Read endpoints are open to any authenticated user (global `AuthGuard` handles this automatically). CUD endpoints add `@UseGuards(IsAdminGuard)`.

**Step 1: Create the controller**

```typescript
// backend/src/modules/labeled-entities/labeled-entities.controller.ts
import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, HttpCode,
} from '@nestjs/common';
import { IsAdminGuard } from '../auth/admin.guard';
import { LabeledEntitiesService } from './labeled-entities.service';
import { CreateLabeledEntityDto } from './dto/create-labeled-entity.dto';
import { UpdateLabeledEntityDto } from './dto/update-labeled-entity.dto';
import { EntityCategory } from '../../database/entities/labeled-entity.entity';

@Controller('labeled-entities')
export class LabeledEntitiesController {
  constructor(private readonly service: LabeledEntitiesService) {}

  // --- Read (any authenticated user) ---

  @Get()
  findAll(
    @Query('category') category?: EntityCategory,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({ category, search });
  }

  @Get('lookup')
  lookupByAddress(@Query('address') address: string) {
    return this.service.lookupByAddress(address);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // --- CUD (admin only) ---

  @Post()
  @UseGuards(IsAdminGuard)
  create(@Body() dto: CreateLabeledEntityDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(IsAdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateLabeledEntityDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(IsAdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/modules/labeled-entities/labeled-entities.controller.ts
git commit -m "feat: add LabeledEntities controller (read=auth, CUD=admin)"
```

---

### Task 6: Module + Wire Up

**Files:**
- Create: `backend/src/modules/labeled-entities/labeled-entities.module.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Create the module**

```typescript
// backend/src/modules/labeled-entities/labeled-entities.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LabeledEntityEntity } from '../../database/entities/labeled-entity.entity';
import { LabeledEntitiesController } from './labeled-entities.controller';
import { LabeledEntitiesService } from './labeled-entities.service';

@Module({
  imports: [TypeOrmModule.forFeature([LabeledEntityEntity])],
  controllers: [LabeledEntitiesController],
  providers: [LabeledEntitiesService],
  exports: [LabeledEntitiesService],
})
export class LabeledEntitiesModule {}
```

**Step 2: Register in app.module.ts**

In `backend/src/app.module.ts`, add the import and include in the `imports` array:

```typescript
import { LabeledEntitiesModule } from './modules/labeled-entities/labeled-entities.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    CasesModule,
    InvestigationsModule,
    TracesModule,
    BlockchainModule,
    AiModule,
    LabeledEntitiesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

**Step 3: Test**

Run: `npm run be`

```bash
# List (should return [])
curl http://localhost:8081/labeled-entities

# Create (dev mode auto-uses admin user)
curl -X POST http://localhost:8081/labeled-entities \
  -H "Content-Type: application/json" \
  -d '{"name":"Binance Hot Wallet 1","category":"exchange","wallets":["0x28C6c06298d514Db089934071355E5743bf21d60"]}'

# Lookup by address (should return the entity above)
curl "http://localhost:8081/labeled-entities/lookup?address=0x28C6c06298d514Db089934071355E5743bf21d60"

# Verify case-insensitive lookup works
curl "http://localhost:8081/labeled-entities/lookup?address=0x28c6c06298d514db089934071355e5743bf21d60"
```

**Step 4: Commit**

```bash
git add backend/src/modules/labeled-entities/labeled-entities.module.ts backend/src/app.module.ts
git commit -m "feat: wire up LabeledEntitiesModule in app"
```

---

### Task 7: Agent Tool — `query_labeled_entities`

**Files:**
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`
- Modify: `backend/src/modules/ai/tools/index.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`
- Modify: `backend/src/modules/ai/ai.module.ts`

**Step 1: Add tool definition in `tool-definitions.ts`**

Add after the `LIST_SCRIPT_RUNS_TOOL` constant (after line 84):

```typescript
// ---------- Labeled entities ----------

export const QUERY_LABELED_ENTITIES_TOOL: Anthropic.Tool = {
  name: 'query_labeled_entities',
  description:
    'Search the Daubert labeled entity registry. Returns known entities (exchanges, mixers, bridges, protocols, individuals, etc.) matching the query. Use to identify who owns a wallet address or to find known entities by name or category.',
  input_schema: {
    type: 'object' as const,
    properties: {
      address: {
        type: 'string',
        description: 'Look up entities by wallet address. Case-insensitive.',
      },
      search: {
        type: 'string',
        description: 'Search entities by name (partial match).',
      },
      category: {
        type: 'string',
        enum: ['exchange', 'mixer', 'bridge', 'protocol', 'individual', 'contract', 'government', 'custodian', 'other'],
        description: 'Filter by entity category.',
      },
    },
    required: [],
  },
};
```

**Step 2: Wire into `index.ts`**

This is the critical wiring step. `backend/src/modules/ai/tools/index.ts` has the `AGENT_TOOLS` array that gets passed to the Anthropic API. Current file:

```typescript
export {
  SKILL_NAMES,
  type SkillName,
  WEB_SEARCH_TOOL,
  GET_CASE_DATA_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
} from './tool-definitions';
// ... import block ...
export const AGENT_TOOLS = [
  WEB_SEARCH_TOOL,
  GET_CASE_DATA_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
];
```

Add `QUERY_LABELED_ENTITIES_TOOL` to all three places:

1. Add to the re-export block: `QUERY_LABELED_ENTITIES_TOOL,`
2. Add to the import block: `QUERY_LABELED_ENTITIES_TOOL,`
3. Add to the `AGENT_TOOLS` array: `QUERY_LABELED_ENTITIES_TOOL,`

**Step 3: Add handler in `ai.service.ts`**

In `backend/src/modules/ai/ai.service.ts`:

1. Add `QUERY_LABELED_ENTITIES_TOOL` to the import from `'./tools'` (line 14-21):
   ```typescript
   import {
     AGENT_TOOLS,
     GET_CASE_DATA_TOOL,
     GET_SKILL_TOOL,
     EXECUTE_SCRIPT_TOOL,
     LIST_SCRIPT_RUNS_TOOL,
     QUERY_LABELED_ENTITIES_TOOL,
     SKILL_NAMES,
   } from './tools';
   ```

2. Inject `LabeledEntitiesService` into the constructor. Find the constructor and add the dependency:
   ```typescript
   import { LabeledEntitiesService } from '../labeled-entities/labeled-entities.service';
   // ... in constructor:
   private readonly labeledEntitiesService: LabeledEntitiesService,
   ```

3. Add a case in the `executeTool` switch statement (at `ai.service.ts:521`), before the `default:` case:
   ```typescript
   case QUERY_LABELED_ENTITIES_TOOL.name: {
     const input = toolUse.input as { address?: string; search?: string; category?: string };
     if (input.address) {
       return this.labeledEntitiesService.lookupByAddress(input.address);
     }
     return this.labeledEntitiesService.findAll({
       category: input.category as any,
       search: input.search,
     });
   }
   ```

**Step 4: Import module in `ai.module.ts`**

In `backend/src/modules/ai/ai.module.ts`, add `LabeledEntitiesModule` to imports so `LabeledEntitiesService` is available for injection:

```typescript
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      InvestigationEntity,
      ScriptRunEntity,
      CaseMemberEntity,
    ]),
    AuthModule,
    LabeledEntitiesModule,
  ],
  // ...
})
```

**Step 5: Test**

Start the backend. Open the AI chat in the browser and ask: "Look up the address 0x28C6c06298d514Db089934071355E5743bf21d60 in the entity registry."

Expected: Agent calls `query_labeled_entities` with the address and returns the Binance entity (if seeded from Task 6 testing).

**Step 6: Commit**

```bash
git add backend/src/modules/ai/tools/tool-definitions.ts backend/src/modules/ai/tools/index.ts backend/src/modules/ai/ai.service.ts backend/src/modules/ai/ai.module.ts
git commit -m "feat: add query_labeled_entities agent tool"
```

---

### Task 8: Frontend API Client

**Files:**
- Modify: `frontend/src/lib/api-client.ts`

**Step 1: Add types and methods**

Add the `LabeledEntity` interface near the other type definitions (after `ScriptRun`). Use the generated types from `api-types.ts` if available; otherwise add manually to match the OpenAPI schema:

```typescript
export interface LabeledEntity {
  id: string;
  name: string;
  category: string;
  description: string | null;
  wallets: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
```

Add methods to the `apiClient` object:

```typescript
  // Labeled Entities
  listLabeledEntities: (filters?: { category?: string; search?: string }) => {
    const params = new URLSearchParams();
    if (filters?.category) params.set('category', filters.category);
    if (filters?.search) params.set('search', filters.search);
    const qs = params.toString();
    return request<LabeledEntity[]>(`/labeled-entities${qs ? `?${qs}` : ''}`);
  },
  getLabeledEntity: (id: string) =>
    request<LabeledEntity>(`/labeled-entities/${id}`),
  lookupLabeledEntity: (address: string) =>
    request<LabeledEntity[]>(`/labeled-entities/lookup?address=${encodeURIComponent(address)}`),
  createLabeledEntity: (body: { name: string; category: string; wallets: string[]; description?: string; metadata?: Record<string, unknown> }) =>
    request<LabeledEntity>('/labeled-entities', { method: 'POST', body: JSON.stringify(body) }),
  updateLabeledEntity: (id: string, body: Partial<{ name: string; category: string; description: string; wallets: string[]; metadata: Record<string, unknown> }>) =>
    request<LabeledEntity>(`/labeled-entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLabeledEntity: (id: string) =>
    request<void>(`/labeled-entities/${id}`, { method: 'DELETE' }),
```

**Step 2: Commit**

```bash
git add frontend/src/lib/api-client.ts
git commit -m "feat: add labeled entity methods to API client"
```

---

### Task 9: Frontend AdminGuard + `/internal` Layout

**Files:**
- Create: `frontend/src/components/AdminGuard.tsx`
- Create: `frontend/src/app/internal/layout.tsx`

**Step 1: Create AdminGuard**

Mirrors `AuthGuard` at `frontend/src/components/AuthGuard.tsx` but adds the admin email check. Must include the `noAccount` handling branch (same as AuthGuard lines 33-44) to avoid a confusing "Access Denied" for admin emails that have no DB account.

```typescript
// frontend/src/components/AdminGuard.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

/**
 * Wraps admin-only pages. Redirects to /login if not signed in,
 * shows "No Account" if noAccount, shows "Access Denied" if not admin,
 * renders children if valid admin.
 * Admin = email ends with @incite.ventures (matches backend IsAdminGuard).
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, noAccount, firebaseUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace('/login');
    }
  }, [loading, firebaseUser, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!firebaseUser) {
    return null;
  }

  if (noAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-white">No Account Found</h2>
          <p className="text-gray-400">
            No account found for {firebaseUser.email}.
            Contact your administrator to get access.
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!user.email.endsWith('@incite.ventures')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-white">Access Denied</h2>
          <p className="text-gray-400">
            This page requires administrator access.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

**Step 2: Create the `/internal` layout**

```typescript
// frontend/src/app/internal/layout.tsx
'use client';

import { AdminGuard } from '@/components/AdminGuard';

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
```

**Step 3: Commit**

```bash
git add frontend/src/components/AdminGuard.tsx frontend/src/app/internal/layout.tsx
git commit -m "feat: add AdminGuard and /internal admin layout"
```

---

### Task 10: `/entities` Page (Read + Conditional Admin CUD)

**Files:**
- Create: `frontend/src/app/entities/layout.tsx`
- Create: `frontend/src/app/entities/page.tsx`

**Step 1: Create the layout**

```typescript
// frontend/src/app/entities/layout.tsx
'use client';

import { AuthGuard } from '@/components/AuthGuard';

export default function EntitiesLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
```

**Step 2: Create the page**

A single page that shows all labeled entities. CUD controls (Add, Edit, Delete) are conditionally rendered when `user.email.endsWith('@incite.ventures')`.

Requirements:
- Table with columns: Name, Category, Wallets (count), Description (truncated)
- Search input (filters by name)
- Category filter dropdown using the enum values: `exchange`, `mixer`, `bridge`, `protocol`, `individual`, `contract`, `government`, `custodian`, `other`
- Click a row to expand and see full wallet list + metadata
- Admin users see:
  - "Add Entity" button that opens an inline form or modal
  - Edit/Delete icons on each row
  - Edit opens an inline form: name, category, description, wallet list (add/remove individual addresses)
- Non-admin users see the table in read-only mode
- Use `useAuth()` to get the current user and check `user.email.endsWith('@incite.ventures')` for the admin check
- Use `apiClient` methods from Task 8
- Follow existing dark theme styling (bg-gray-900, gray-700 borders, blue-500 accents)
- Use `react-icons/fa6` for icons (no emojis — project convention)

**Step 3: Test**

Run: `npm run fe`

- Navigate to `http://localhost:3001/entities`
- With an admin account: should see CUD controls, create/edit/delete an entity
- With a non-admin account: should see read-only table
- Search and category filter should work
- Expanding a row should show full wallet list

**Step 4: Commit**

```bash
git add frontend/src/app/entities/
git commit -m "feat: add /entities page with conditional admin CUD controls"
```

---

### Task 11: `useLabeledEntities` Hook

**Files:**
- Create: `frontend/src/hooks/useLabeledEntities.ts`

This hook fetches all labeled entities once and caches them for the session. Used by the DetailsPanel (Task 12) for address lookups without hitting the API on every node click.

**Step 1: Create the hook**

```typescript
// frontend/src/hooks/useLabeledEntities.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, type LabeledEntity } from '@/lib/api-client';

/**
 * Fetches all labeled entities on mount, caches in memory.
 * Provides a lookup function for matching addresses to entities.
 * Call `refresh()` to re-fetch (e.g., after admin creates a new entity).
 */
export function useLabeledEntities() {
  const [entities, setEntities] = useState<LabeledEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const walletMapRef = useRef<Map<string, LabeledEntity>>(new Map());

  const fetch = useCallback(async () => {
    try {
      const data = await apiClient.listLabeledEntities();
      setEntities(data);

      // Build address -> entity lookup map (lowercased keys)
      const map = new Map<string, LabeledEntity>();
      for (const entity of data) {
        for (const wallet of entity.wallets) {
          map.set(wallet.toLowerCase(), entity);
        }
      }
      walletMapRef.current = map;
    } catch (err) {
      console.error('Failed to fetch labeled entities:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const lookupAddress = useCallback(
    (address: string): LabeledEntity | undefined => {
      return walletMapRef.current.get(address.toLowerCase());
    },
    [],
  );

  return { entities, loading, lookupAddress, refresh: fetch };
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/useLabeledEntities.ts
git commit -m "feat: add useLabeledEntities hook with address lookup"
```

---

### Task 12: Daubert Label Badge in DetailsPanel

**Files:**
- Modify: `frontend/src/components/DetailsPanel.tsx`

**Step 1: Understand the current DetailsPanel**

Read `frontend/src/components/DetailsPanel.tsx` fully before editing. Find:
1. Where node details are rendered (look for the section that shows the selected node's address, name, tags, etc.)
2. What props the component receives (the selected node/edge, investigation data, etc.)
3. Where to call the `lookupAddress` function

**Step 2: Integrate the hook**

Two options depending on architecture:
- **Option A (preferred):** Call `useLabeledEntities()` inside DetailsPanel directly. Simpler, self-contained.
- **Option B:** Call the hook in the parent (investigations page) and pass `lookupAddress` as a prop. Better if other components also need entity lookup.

Go with Option A unless the parent already manages a similar cache.

**Step 3: Add the badge**

In the node detail section, after the node name/address display, add:

```tsx
// Inside the node detail rendering, after the address display:
const matchedEntity = lookupAddress(node.address);

{matchedEntity && (
  <div className="flex items-center gap-2 mt-1">
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryStyle(matchedEntity.category)}`}>
      {matchedEntity.category}
    </span>
    <span className="text-sm text-gray-300">{matchedEntity.name}</span>
  </div>
)}
```

Add a helper for category badge colors:

```typescript
function getCategoryStyle(category: string): string {
  switch (category) {
    case 'exchange': return 'bg-blue-900/50 text-blue-300';
    case 'mixer': return 'bg-red-900/50 text-red-300';
    case 'bridge': return 'bg-purple-900/50 text-purple-300';
    case 'protocol': return 'bg-green-900/50 text-green-300';
    case 'individual': return 'bg-yellow-900/50 text-yellow-300';
    case 'contract': return 'bg-cyan-900/50 text-cyan-300';
    case 'government': return 'bg-orange-900/50 text-orange-300';
    case 'custodian': return 'bg-indigo-900/50 text-indigo-300';
    default: return 'bg-gray-700 text-gray-300';
  }
}
```

**Step 4: Test**

- Create a labeled entity (via `/entities` or curl) with a wallet address that exists in an investigation graph
- Open the investigation, click the node
- Verify the Daubert Label badge appears with the correct category color and entity name
- Click a node whose address is NOT in the registry — no badge should appear

**Step 5: Commit**

```bash
git add frontend/src/components/DetailsPanel.tsx
git commit -m "feat: surface Daubert Label badge on matched nodes in DetailsPanel"
```
