/**
 * E2E: script-role-enforcement
 *
 * Verifies that the role baked into a script token is actually enforced at the
 * PATCH /productions/:id route boundary — a surface that routes through
 * CaseAccessService.assertRole (not @RequireRole) and therefore correctly
 * exercises the per-script-role enforcement added in Tasks 1–4.
 *
 * Three assertions:
 *  1. viewer-signed token       → PATCH /productions/:id → 403
 *  2. editor-signed token       → PATCH /productions/:id → 200
 *  3. cross-case editor token   → PATCH /productions/:id → 403 (wrong caseId)
 */

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as request from 'supertest';

// All entities — TypeORM needs the full set to resolve @OneToMany / @ManyToOne
// inverse-side metadata across the entity graph.
import { entities } from '../src/database/entities';
import { CaseEntity } from '../src/database/entities/case.entity';
import { CaseMemberEntity } from '../src/database/entities/case-member.entity';
import { ProductionEntity, ProductionType } from '../src/database/entities/production.entity';
import { UserEntity } from '../src/database/entities/user.entity';

// Services
import { AuthGuard } from '../src/modules/auth/auth.guard';
import { FIREBASE_ADMIN } from '../src/modules/auth/firebase-admin.provider';
import { UsersService } from '../src/modules/users/users.service';
import { CaseAccessService } from '../src/modules/auth/case-access.service';
import { ScriptTokenService } from '../src/modules/script/script-token.service';
import { ProductionsController } from '../src/modules/productions/productions.controller';
import { ProductionsService } from '../src/modules/productions/productions.service';

// Use the dev DB (running on port 5433 in this environment).
// If DATABASE_URL is already set in the process (e.g. CI), keep it.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://daubert:daubert@localhost:5433/daubert';

describe('PATCH /productions/:id — script token role enforcement (e2e)', () => {
  let app: INestApplication;

  let caseId: string;
  let productionId: string;

  let viewerToken: string;
  let editorToken: string;
  let crossCaseEditorToken: string;

  let userRepo: Repository<UserEntity>;
  let caseRepo: Repository<CaseEntity>;
  let memberRepo: Repository<CaseMemberEntity>;
  let productionRepo: Repository<ProductionEntity>;

  let seedUserId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities,          // full entity list keeps TypeORM relation metadata valid
          synchronize: false, // schema already exists; don't touch it
          ssl: false,
        }),
        TypeOrmModule.forFeature([
          UserEntity,
          CaseEntity,
          CaseMemberEntity,
          ProductionEntity,
        ]),
      ],
      controllers: [ProductionsController],
      providers: [
        // Real AuthGuard wired globally — exercises script-token path end-to-end
        {
          provide: APP_GUARD,
          useClass: AuthGuard,
        },
        // Stub Firebase — the tests only exercise the X-Script-Token path;
        // Firebase's verifyIdToken is never called.
        {
          provide: FIREBASE_ADMIN,
          useValue: {
            auth: () => ({
              verifyIdToken: jest
                .fn()
                .mockRejectedValue(new Error('no firebase in script-role e2e')),
            }),
          },
        },
        // Minimal UsersService stub — only reached after a valid Firebase token,
        // which never happens here.
        {
          provide: UsersService,
          useValue: {
            findByFirebaseUid: jest.fn().mockResolvedValue(null),
            findByEmail: jest.fn().mockResolvedValue(null),
          },
        },
        // Real services under test
        ScriptTokenService,
        CaseAccessService,
        ProductionsService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    userRepo = moduleRef.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    caseRepo = moduleRef.get<Repository<CaseEntity>>(getRepositoryToken(CaseEntity));
    memberRepo = moduleRef.get<Repository<CaseMemberEntity>>(
      getRepositoryToken(CaseMemberEntity),
    );
    productionRepo = moduleRef.get<Repository<ProductionEntity>>(
      getRepositoryToken(ProductionEntity),
    );

    // ── Seed ──────────────────────────────────────────────────────────────────

    const user = await userRepo.save(
      userRepo.create({
        name: 'E2E Script Role Test User',
        email: `e2e-script-role-${Date.now()}@test.invalid`,
        firebaseUid: null,
        orgRole: 'member',
      }),
    );
    seedUserId = user.id;

    const testCase = await caseRepo.save(
      caseRepo.create({ name: 'E2E Script Role Test Case', userId: user.id }),
    );
    caseId = testCase.id;

    await memberRepo.save(
      memberRepo.create({ userId: user.id, caseId, role: 'owner' }),
    );

    const production = await productionRepo.save(
      productionRepo.create({
        name: 'E2E Test Production',
        type: ProductionType.REPORT,
        data: {},
        caseId,
      }),
    );
    productionId = production.id;

    // ── Sign tokens ───────────────────────────────────────────────────────────
    const scriptTokenService = moduleRef.get(ScriptTokenService);
    viewerToken = scriptTokenService.sign(caseId, 'viewer');
    editorToken = scriptTokenService.sign(caseId, 'editor');
    crossCaseEditorToken = scriptTokenService.sign(
      '00000000-0000-0000-0000-000000000000',
      'editor',
    );
  }, 30_000 /* allow up to 30s for DB connection + seeding */);

  afterAll(async () => {
    // Delete in FK-safe order. The cascade on case → members/productions
    // handles children, but we delete production explicitly to avoid relying
    // on cascade behaviour in the test environment.
    if (productionId) await productionRepo.delete({ id: productionId });
    if (caseId) await caseRepo.delete({ id: caseId });
    if (seedUserId) await userRepo.delete({ id: seedUserId });
    if (app) await app.close();
  }, 15_000);

  it('viewer-signed script cannot mutate a production (expects 403)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/productions/${productionId}`)
      .set('X-Script-Token', viewerToken)
      .send({ name: 'should fail' });

    expect(res.status).toBe(403);
    // Confirm the 403 carries the role-enforcement message, not an unrelated error
    expect(JSON.stringify(res.body)).toMatch(/editor/i);
  });

  it('editor-signed script can mutate a production (expects 200)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/productions/${productionId}`)
      .set('X-Script-Token', editorToken)
      .send({ name: 'updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('updated');
  });

  it('cross-case editor token is still rejected (expects 403)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/productions/${productionId}`)
      .set('X-Script-Token', crossCaseEditorToken)
      .send({ name: 'wrong case' });

    expect(res.status).toBe(403);
    // Confirm the 403 is the cross-case isolation message, not a different failure
    expect(JSON.stringify(res.body)).toMatch(/cross_case_access/i);
  });
});
