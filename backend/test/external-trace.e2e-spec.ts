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
  // Typed `any`: the module only provides a partial `useValue` stub for
  // BlockchainService (see providers below), so we reach the shared
  // jest.fn() through this handle to queue per-test mock returns via
  // mockResolvedValueOnce without disturbing the default mock other
  // tests in this describe block rely on.
  let blockchainServiceMock: any;

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
    blockchainServiceMock = moduleRef.get(BlockchainService);
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
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=optimism&hops=1')
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

  it('returns 200 for bitcoin chain with a valid bech32 address', async () => {
    const res = await request(app.getHttpServer())
      .get(
        '/external/trace?address=bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4&chain=bitcoin&hops=1',
      )
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.20')
      .expect(200);
    expect(res.body).toMatchObject({
      root: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      chain: 'bitcoin',
      hops: 1,
      nodes: expect.any(Array),
      edges: expect.any(Array),
      truncated: false,
    });
  });

  it('returns 200 for bitcoin chain with a junction node + a direct edge, and never leaks raw utxo arrays', async () => {
    // A different address than the other bitcoin tests use -- the service
    // caches by `${chain}:${address}:${hops}`, and reusing an address that
    // an earlier test already traced would serve the cached (empty) result
    // instead of invoking fetchHistory again, silently no-op-ing the mock
    // queued below.
    const BTC_ROOT = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

    // Distinctive markers planted inside the mocked junction row's raw
    // utxo.inputs/outputs/warnings -- graph-builder must reduce these to
    // counts-only (utxoSummary), never pass them through verbatim.
    const LEAK_INPUT_1 = 'zzleakedjunctioninputaddressonezz';
    const LEAK_INPUT_2 = 'zzleakedjunctioninputaddresstwozz';
    const LEAK_CHANGE_OUTPUT = 'zzleakedjunctionchangeoutputzz';
    const LEAK_WARNING = 'zzleakedwarningmarkerzz';
    const LEAK_CHANGE_EVIDENCE = 'zzleakedchangeevidencemarkerzz';

    const directRow = {
      id: 'btc-direct-1',
      from: 'bc1qdirectsenderaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to: BTC_ROOT,
      txHash: 'directtxid0000000000000000000000000000000000000000000000000000',
      chain: 'bitcoin',
      timestamp: '2026-08-01T00:00:00.000Z',
      amount: '12345678',
      token: { address: '', symbol: 'BTC', decimals: 8 },
      blockNumber: 900000,
      notes: '',
      tags: [],
      crossTrace: false,
      utxo: {
        inputs: [
          {
            address: 'bc1qdirectsenderaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            value: '12345678',
            prevTxid: 'prevdirecttxid',
            prevVout: 0,
          },
        ],
        outputs: [{ address: BTC_ROOT, value: '12345678', index: 0 }],
        fee: '500',
        warnings: [],
        confirmed: true,
        blockHeight: 900000,
        vout: 0,
        junction: false,
      },
    };

    const junctionRow = {
      id: 'btc-junction-1',
      from: '',
      to: BTC_ROOT,
      txHash: 'junctiontxid000000000000000000000000000000000000000000000000',
      chain: 'bitcoin',
      timestamp: '2026-08-01T00:05:00.000Z',
      amount: '5000000',
      token: { address: '', symbol: 'BTC', decimals: 8 },
      blockNumber: 900001,
      notes: '',
      tags: [],
      crossTrace: false,
      utxo: {
        inputs: [
          { address: LEAK_INPUT_1, value: '3000000', prevTxid: 'prevjunc1', prevVout: 0 },
          { address: LEAK_INPUT_2, value: '2500000', prevTxid: 'prevjunc2', prevVout: 1 },
        ],
        outputs: [
          { address: BTC_ROOT, value: '5000000', index: 0 },
          {
            address: LEAK_CHANGE_OUTPUT,
            value: '400000',
            index: 1,
            change: true,
            changeEvidence: [LEAK_CHANGE_EVIDENCE],
          },
        ],
        fee: '9999',
        warnings: [LEAK_WARNING],
        confirmed: true,
        blockHeight: 900001,
        vout: 0,
        junction: true,
      },
    };

    blockchainServiceMock.fetchHistory.mockResolvedValueOnce({
      transactions: [directRow, junctionRow],
      chain: 'bitcoin',
      address: BTC_ROOT,
    });

    const res = await request(app.getHttpServer())
      .get(`/external/trace?address=${BTC_ROOT}&chain=bitcoin&hops=1`)
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.23')
      .expect(200);

    const body = res.body;

    const junctionNode = body.nodes.find((n: any) => n.id === junctionRow.txHash);
    expect(junctionNode).toBeDefined();
    expect(junctionNode.kind).toBe('txJunction');
    expect(junctionNode.utxoSummary).toEqual({ inputs: 2, outputs: 2, fee: '9999' });

    const directEdge = body.edges.find(
      (e: any) => e.from === directRow.from && e.to === BTC_ROOT,
    );
    expect(directEdge).toBeDefined();
    expect(directEdge.amount).toBe('0.1234');
    expect(directEdge.txCount).toBe(1);

    // No node -- junction or otherwise -- carries the raw ledger detail.
    for (const node of body.nodes) {
      expect(node).not.toHaveProperty('inputs');
      expect(node).not.toHaveProperty('outputs');
      expect(node).not.toHaveProperty('changeEvidence');
      expect(node).not.toHaveProperty('warnings');
    }

    // Belt-and-braces: the raw utxo.inputs/outputs/warnings arrays must
    // never leave the backend on this public endpoint. Scan the whole
    // payload (not just the node we already checked) for the distinctive
    // markers planted above.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(LEAK_INPUT_1);
    expect(raw).not.toContain(LEAK_INPUT_2);
    expect(raw).not.toContain(LEAK_CHANGE_OUTPUT);
    expect(raw).not.toContain(LEAK_WARNING);
    expect(raw).not.toContain(LEAK_CHANGE_EVIDENCE);
  });

  it('returns 400 for bitcoin chain with an EVM-shaped address (DTO passes, service rejects the mismatch)', async () => {
    const res = await request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=bitcoin&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.21')
      .expect(400);
    // The DTO regex accepts any of the four address families regardless of `chain`,
    // so this 400 must originate from ExternalTraceService.validateAddressChain ->
    // validateAddressForChain, not from the DTO's @Matches validator.
    expect(res.body.message).toBe(
      'bitcoin requires a base58 (1…/3…) or bech32 (bc1…) address',
    );
  });

  it('returns 400 for bitcoin chain with a mixed-case bech32 address (DTO rejects: bech32 is lowercase-only)', async () => {
    const res = await request(app.getHttpServer())
      .get(
        '/external/trace?address=bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4&chain=bitcoin&hops=1',
      )
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.22')
      .expect(400);
    expect(res.body.message).toContain(
      'address must be an EVM (0x…), Tron (T…), Bitcoin (1…/3…/bc1…), or Solana (base58) address',
    );
  });

  it('returns 200 for solana chain with a valid base58 address', async () => {
    const res = await request(app.getHttpServer())
      .get(
        '/external/trace?address=So11111111111111111111111111111111111111112&chain=solana&hops=1',
      )
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.24')
      .expect(200);
    expect(res.body).toMatchObject({
      root: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      hops: 1,
      nodes: expect.any(Array),
      edges: expect.any(Array),
      truncated: false,
    });
  });

  it('returns 200 for solana chain, and never leaks internal solana context (spamEvidence, token accounts, feePayer)', async () => {
    // A different address than the other solana test uses -- the service
    // caches by `${chain}:${address}:${hops}`, and reusing an address that
    // an earlier test already traced would serve the cached result instead
    // of invoking fetchHistory again, silently no-op-ing the mock queued below.
    const SOL_ROOT = 'SoLLeakRootAddr111111111111111111';
    const SOL_CP = 'SoLLeakCpAddr1111111111111111111111';
    const SPL_MINT = 'SPLLeakMintAddr111111111111111111';

    // Distinctive markers planted inside the mocked row's `solana` context --
    // graph-builder must never copy these into the public output.
    const LEAK_SPAM_EVIDENCE = 'LEAK_SPAM_EVIDENCE';
    const LEAK_FROM_TOKEN_ACCOUNT = 'LEAK_FROM_TOKEN_ACCOUNT';
    const LEAK_TO_TOKEN_ACCOUNT = 'LEAK_TO_TOKEN_ACCOUNT';
    const LEAK_FEE_PAYER = 'LEAK_FEE_PAYER';

    const solRow = {
      id: 'sol-leak-1',
      from: SOL_CP,
      to: SOL_ROOT,
      txHash: 'solleaktxsig00000000000000000000000000000000',
      chain: 'solana',
      timestamp: '2026-08-01T00:00:00.000Z',
      amount: '500000',
      token: { address: SPL_MINT, symbol: 'USDC', decimals: 6 },
      blockNumber: 1,
      notes: '',
      tags: [],
      crossTrace: false,
      solana: {
        transferIndex: 0,
        feePayer: LEAK_FEE_PAYER,
        kind: 'spl',
        spam: false,
        spamEvidence: [LEAK_SPAM_EVIDENCE],
        fromTokenAccount: LEAK_FROM_TOKEN_ACCOUNT,
        toTokenAccount: LEAK_TO_TOKEN_ACCOUNT,
      },
    };

    blockchainServiceMock.fetchHistory.mockResolvedValueOnce({
      transactions: [solRow],
      chain: 'solana',
      address: SOL_ROOT,
    });

    const res = await request(app.getHttpServer())
      .get(`/external/trace?address=${SOL_ROOT}&chain=solana&hops=1`)
      .set('X-Daubert-Website-Key', KEY)
      .set('X-Forwarded-For', '203.0.113.25')
      .expect(200);

    const body = res.body;

    const edge = body.edges.find((e: any) => e.from === SOL_CP && e.to === SOL_ROOT);
    expect(edge).toBeDefined();

    // The raw solana context -- spamEvidence, token accounts, feePayer --
    // must never leave the backend on this public endpoint. Scan the whole
    // payload (not just the edge we already checked) for the markers planted
    // above.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(LEAK_SPAM_EVIDENCE);
    expect(raw).not.toContain(LEAK_FROM_TOKEN_ACCOUNT);
    expect(raw).not.toContain(LEAK_TO_TOKEN_ACCOUNT);
    expect(raw).not.toContain(LEAK_FEE_PAYER);
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
