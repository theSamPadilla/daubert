import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { ExternalTraceController } from '../src/modules/external-trace/external-trace.controller';
import { ExternalTraceService } from '../src/modules/external-trace/external-trace.service';
import { WebsiteKeyGuard } from '../src/modules/external-trace/website-key.guard';
import { ForwardedIpThrottlerGuard } from '../src/modules/external-trace/forwarded-ip.guard';
import { BlockchainService } from '../src/modules/blockchain/blockchain.service';
import { LabeledEntitiesService } from '../src/modules/labeled-entities/labeled-entities.service';

const KEY = process.env.DAUBERT_WEBSITE_API_KEY!;

describe('GET /external/trace (e2e)', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => app.close());

  it('returns 401 when the key header is missing', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .expect(401));

  it('returns 401 when the key header is wrong', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', 'wrong-key-wrong-key-wr')
      .expect(401));

  it('returns 400 for missing address (with valid key)', () =>
    request(app.getHttpServer())
      .get('/external/trace?chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .expect(400));

  it('returns 400 for unsupported chain (with valid key)', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=solana&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .expect(400));

  it('returns 200 + graph shape on valid request', async () => {
    const res = await request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', KEY)
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
});
