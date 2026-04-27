import { ScriptTokenService } from './script-token.service';

describe('ScriptTokenService', () => {
  let service: ScriptTokenService;

  beforeEach(() => {
    service = new ScriptTokenService();
  });

  it('round-trips a valid token', () => {
    const token = service.sign('case-1');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(service.verify(token)).toEqual({ caseId: 'case-1' });
  });

  it('round-trips with various caseIds', () => {
    for (const id of ['abc', '00000000-0000-0000-0000-000000000000', 'X']) {
      expect(service.verify(service.sign(id))).toEqual({ caseId: id });
    }
  });

  it('rejects tampered token (modified suffix)', () => {
    const token = service.sign('case-1');
    const tampered = token.slice(0, -3) + 'xxx';
    expect(service.verify(tampered)).toBeNull();
  });

  it('rejects tampered token (truncated)', () => {
    const token = service.sign('case-1');
    expect(service.verify(token.slice(0, token.length - 5))).toBeNull();
  });

  it('rejects token signed by a different ScriptTokenService instance', () => {
    const other = new ScriptTokenService();
    const token = other.sign('case-1');
    expect(service.verify(token)).toBeNull();
  });

  it('rejects expired token (>60s)', () => {
    const token = service.sign('case-1');
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(service.verify(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('accepts a token still within the 60s window', () => {
    const token = service.sign('case-1');
    const realNow = Date.now;
    Date.now = () => realNow() + 30_000;
    try {
      expect(service.verify(token)).toEqual({ caseId: 'case-1' });
    } finally {
      Date.now = realNow;
    }
  });

  it('rejects empty string', () => {
    expect(service.verify('')).toBeNull();
  });

  it('rejects garbage / non-token strings', () => {
    expect(service.verify('not-a-token')).toBeNull();
    expect(service.verify('a.b')).toBeNull();
    expect(service.verify('a.b.c.d')).toBeNull();
  });

  it('rejects token with non-numeric timestamp', () => {
    const fake = Buffer.from('case-1.notanum.deadbeef', 'utf8').toString(
      'base64url',
    );
    expect(service.verify(fake)).toBeNull();
  });

  it('rejects token with empty caseId', () => {
    const fake = Buffer.from(`.${Date.now()}.deadbeef`, 'utf8').toString(
      'base64url',
    );
    expect(service.verify(fake)).toBeNull();
  });
});
