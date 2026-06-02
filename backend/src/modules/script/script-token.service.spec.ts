import { ScriptTokenService } from './script-token.service';
import { CaseRole } from '../../database/entities/case-member.entity';

describe('ScriptTokenService', () => {
  let service: ScriptTokenService;

  beforeEach(() => {
    service = new ScriptTokenService();
  });

  it('round-trips a valid token with role', () => {
    const token = service.sign('case-1', 'editor');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(service.verify(token)).toEqual({ caseId: 'case-1', role: 'editor' });
  });

  it('round-trips for every role', () => {
    for (const role of ['viewer', 'editor', 'owner'] as CaseRole[]) {
      const t = service.sign('c1', role);
      expect(service.verify(t)).toEqual({ caseId: 'c1', role });
    }
  });

  it('round-trips with various caseId shapes', () => {
    for (const id of ['abc', '00000000-0000-0000-0000-000000000000', 'X']) {
      expect(service.verify(service.sign(id, 'viewer'))).toEqual({
        caseId: id,
        role: 'viewer',
      });
    }
  });

  it('rejects tampered token (modified suffix)', () => {
    const token = service.sign('case-1', 'viewer');
    const tampered = token.slice(0, -3) + 'xxx';
    expect(service.verify(tampered)).toBeNull();
  });

  it('rejects tampered token (truncated)', () => {
    const token = service.sign('case-1', 'viewer');
    expect(service.verify(token.slice(0, token.length - 5))).toBeNull();
  });

  it('rejects token signed by a different ScriptTokenService instance', () => {
    const other = new ScriptTokenService();
    const token = other.sign('case-1', 'editor');
    expect(service.verify(token)).toBeNull();
  });

  it('rejects expired token (>60s)', () => {
    const token = service.sign('case-1', 'editor');
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(service.verify(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('accepts a token still within the 60s window', () => {
    const token = service.sign('case-1', 'owner');
    const realNow = Date.now;
    Date.now = () => realNow() + 30_000;
    try {
      expect(service.verify(token)).toEqual({ caseId: 'case-1', role: 'owner' });
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
    expect(service.verify('a.b.c')).toBeNull();
    expect(service.verify('a.b.c.d.e')).toBeNull();
  });

  it('rejects token with non-numeric timestamp', () => {
    const fake = Buffer.from('case-1.editor.notanum.deadbeef', 'utf8').toString(
      'base64url',
    );
    expect(service.verify(fake)).toBeNull();
  });

  it('rejects token with empty caseId', () => {
    const fake = Buffer.from(`.editor.${Date.now()}.deadbeef`, 'utf8').toString(
      'base64url',
    );
    expect(service.verify(fake)).toBeNull();
  });

  it('rejects token with invalid role value', () => {
    // Forge a payload with an unknown role; signature won't match the legit key,
    // but verify must reject on the role field check too — defense in depth.
    const fake = Buffer.from(`case-1.superadmin.${Date.now()}.deadbeef`, 'utf8').toString(
      'base64url',
    );
    expect(service.verify(fake)).toBeNull();
  });
});
