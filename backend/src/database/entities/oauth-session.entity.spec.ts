import { getMetadataArgsStorage } from 'typeorm';
import { OAuthSessionEntity } from './oauth-session.entity';

describe('OAuthSessionEntity metadata', () => {
  const storage = getMetadataArgsStorage();

  it('maps to the oauth_session table', () => {
    const table = storage.tables.find((t) => t.target === OAuthSessionEntity);
    expect(table?.name).toBe('oauth_session');
  });

  it('has an organization_id column (Daubert adaptation)', () => {
    const cols = storage.columns.filter((c) => c.target === OAuthSessionEntity);
    const orgCol = cols.find(
      (c) =>
        c.propertyName === 'organizationId' ||
        (c.options as any).name === 'organization_id',
    );
    expect(orgCol).toBeDefined();
  });

  it('does NOT have a scope column (Daubert adaptation)', () => {
    const cols = storage.columns.filter((c) => c.target === OAuthSessionEntity);
    const scopeCol = cols.find(
      (c) => c.propertyName === 'scope' || (c.options as any).name === 'scope',
    );
    expect(scopeCol).toBeUndefined();
  });

  it('access_token_hash and refresh_token_hash are varchar(64)', () => {
    const cols = storage.columns.filter((c) => c.target === OAuthSessionEntity);
    const access = cols.find(
      (c) =>
        c.propertyName === 'accessTokenHash' ||
        (c.options as any).name === 'access_token_hash',
    );
    const refresh = cols.find(
      (c) =>
        c.propertyName === 'refreshTokenHash' ||
        (c.options as any).name === 'refresh_token_hash',
    );
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    expect((access!.options as any).length).toBe(64);
    expect((refresh!.options as any).length).toBe(64);
  });
});
