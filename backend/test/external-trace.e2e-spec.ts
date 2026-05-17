import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { ExternalTraceController } from '../src/modules/external-trace/external-trace.controller';
import { ExternalTraceService } from '../src/modules/external-trace/external-trace.service';
import { WebsiteKeyGuard } from '../src/modules/external-trace/website-key.guard';
import { ForwardedIpThrottlerGuard } from '../src/modules/external-trace/forwarded-ip.guard';
import { BlockchainService } from '../src/modules/blockchain/blockchain.service';
import { LabeledEntitiesService } from '../src/modules/labeled-entities/labeled-entities.service';
import { AuthGuard } from '../src/modules/auth/auth.guard';
import { FIREBASE_ADMIN } from '../src/modules/auth/firebase-admin.provider';
import { UsersService } from '../src/modules/users/users.service';
import { ScriptTokenService } from '../src/modules/script/script-token.service';

const KEY = process.env.DAUBERT_WEBSITE_API_KEY!;

describe('GET /external/trace (e2e)', () => {
  let app: INestApplication;
  let throttlerStorage: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // Provide ConfigService backed by process.env (already populated by setupFiles)
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        ThrottlerModule.forRoot([{ name: 'default', limit: 10, ttl: 60_000 }]),
      ],
      controllers: [ExternalTraceController],
      providers: [
        ExternalTraceService,
        WebsiteKeyGuard,
        ForwardedIpThrottlerGuard,
        {
          provide: BlockchainService,
          useValue: {
            fetchHistory: jest.fn().mockResolvedValue({
              transactions: [],
              chain: 'ethereum',
              address: '0xaaa',
            }),
          },
        },
        {
          provide: LabeledEntitiesService,
          useValue: { lookupByAddresses: jest.fn().mockResolvedValue(new Map()) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    (app.getHttpAdapter().getInstance() as any).set('trust proxy', true);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    throttlerStorage = moduleRef.get(ThrottlerStorage);
  });

  afterAll(async () => app.close());

  // Reset throttler storage before each test so buckets don't leak between tests.
  beforeEach(() => {
    if (throttlerStorage?._storage) {
      throttlerStorage._storage = {};
    }
  });

  it('returns 401 when the key header is missing', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Forwarded-For', '203.0.113.1')
      .expect(401));

  it('returns 401 when the key header is wrong', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', 'wrong-key-wrong-key-wr')
      .set('X-Forwarded-For', '203.0.113.2')
      .expect(401));

  it('returns 400 for missing address (with valid key)', async () => {
    const res = await request(app.getHttpServer())
      .get('/external/trace?chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.3')
      .expect(400);
    // class-validator surfaces an array under .message
    expect(JSON.stringify(res.body)).toMatch(/address/i);
  });

  it('returns 400 for unsupported chain (with valid key)', async () => {
    const res = await request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=solana&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.4')
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/chain/i);
  });

  it('returns 200 + graph shape on valid request', async () => {
    const res = await request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.5')
      .expect(200);
    expect(res.body).toMatchObject({
      root: '0x0000000000000000000000000000000000000000',
      chain: 'ethereum',
      hops: 1,
      nodes: expect.any(Array),
      edges: expect.any(Array),
      truncated: false,
    });
  });

  it('returns 429 after exceeding the per-IP rate limit (10/min)', async () => {
    const IP = '198.51.100.10';
    const url = '/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1';

    // 10 requests should all succeed
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .get(url)
        .set('X-Daubert-Website-Key', KEY)
        .set('X-Forwarded-For', IP)
        .expect(200);
    }
    // The 11th hits the throttler
    await request(app.getHttpServer())
      .get(url)
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', IP)
      .expect(429);
  });
});

describe('GET /external/trace with real AuthGuard wired (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        ThrottlerModule.forRoot([{ name: 'default', limit: 100, ttl: 60_000 }]),
      ],
      controllers: [ExternalTraceController],
      providers: [
        // Wire the real AuthGuard as the global guard via APP_GUARD
        {
          provide: APP_GUARD,
          useClass: AuthGuard,
        },
        // Stub Firebase admin — AuthGuard only calls firebaseApp.auth().verifyIdToken()
        // on the non-@Public() path; @Public() routes return true before touching it.
        {
          provide: FIREBASE_ADMIN,
          useValue: {
            auth: () => ({ verifyIdToken: jest.fn().mockRejectedValue(new Error('no token')) }),
          },
        },
        // Stub UsersService — only reached after a valid Firebase token, never on @Public()
        {
          provide: UsersService,
          useValue: {
            findByFirebaseUid: jest.fn().mockResolvedValue(null),
            findByEmail: jest.fn().mockResolvedValue(null),
          },
        },
        // ScriptTokenService has no dependencies on external infra — use the real one
        ScriptTokenService,
        ExternalTraceService,
        WebsiteKeyGuard,
        ForwardedIpThrottlerGuard,
        {
          provide: BlockchainService,
          useValue: {
            fetchHistory: jest.fn().mockResolvedValue({
              transactions: [],
              chain: 'ethereum',
              address: '0x0000000000000000000000000000000000000000',
            }),
          },
        },
        {
          provide: LabeledEntitiesService,
          useValue: { lookupByAddresses: jest.fn().mockResolvedValue(new Map()) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    (app.getHttpAdapter().getInstance() as any).set('trust proxy', true);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());

  it('@Public() bypasses AuthGuard: valid request returns 200 without a Bearer token', async () => {
    // If @Public() were removed from the controller action, AuthGuard would reject
    // this request with 401 because there is no Authorization header.
    const res = await request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.10')
      .expect(200);
    expect(res.body).toMatchObject({
      root: '0x0000000000000000000000000000000000000000',
      chain: 'ethereum',
    });
  });
});
