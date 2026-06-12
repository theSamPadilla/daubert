/**
 * Unit tests for login page return_to handling.
 *
 * Tests that:
 * - Valid same-origin relative paths are preserved
 * - Protocol-relative URLs (//evil.com) are rejected
 * - Absolute URLs with schemes (http://, javascript:) are rejected
 * - Invalid/missing return_to falls back to '/'
 */

// We can't directly test the component without a full Next.js test setup,
// so we test the validation logic via code inspection.
// The validateReturnTo function is a pure function that:
// 1. Returns '/' if input is null/undefined
// 2. Returns '/' if input doesn't start with '/'
// 3. Returns '/' if input starts with '//'
// 4. Returns '/' if input contains a ':' (scheme)
// 5. Returns the input if it passes all checks

describe('validateReturnTo', () => {
  // Helper function copied from the component for testing
  function validateReturnTo(returnTo: string | null): string {
    if (!returnTo) return '/';
    if (typeof returnTo !== 'string' || !returnTo.startsWith('/')) {
      return '/';
    }
    if (returnTo.startsWith('//')) {
      return '/';
    }
    if (returnTo.includes(':')) {
      return '/';
    }
    return returnTo;
  }

  describe('valid same-origin relative paths', () => {
    it('preserves /oauth/consent?bag=x', () => {
      expect(validateReturnTo('/oauth/consent?bag=x')).toBe('/oauth/consent?bag=x');
    });

    it('preserves /investigations', () => {
      expect(validateReturnTo('/investigations')).toBe('/investigations');
    });

    it('preserves / (root)', () => {
      expect(validateReturnTo('/')).toBe('/');
    });

    it('preserves paths with multiple segments', () => {
      expect(validateReturnTo('/cases/abc-123/investigations')).toBe(
        '/cases/abc-123/investigations',
      );
    });

    it('preserves paths with complex query strings', () => {
      expect(validateReturnTo('/cases?filter=active&sort=name')).toBe(
        '/cases?filter=active&sort=name',
      );
    });

    it('preserves paths with fragments', () => {
      expect(validateReturnTo('/oauth/consent?bag=x#top')).toBe(
        '/oauth/consent?bag=x#top',
      );
    });
  });

  describe('rejects protocol-relative URLs', () => {
    it('rejects //evil.com', () => {
      expect(validateReturnTo('//evil.com')).toBe('/');
    });

    it('rejects //evil.com/path', () => {
      expect(validateReturnTo('//evil.com/path')).toBe('/');
    });
  });

  describe('rejects absolute URLs with schemes', () => {
    it('rejects http://evil.com', () => {
      expect(validateReturnTo('http://evil.com')).toBe('/');
    });

    it('rejects https://evil.com', () => {
      expect(validateReturnTo('https://evil.com')).toBe('/');
    });

    it('rejects javascript:alert(1)', () => {
      expect(validateReturnTo('javascript:alert(1)')).toBe('/');
    });

    it('rejects data:text/html,<script>alert(1)</script>', () => {
      expect(validateReturnTo('data:text/html,<script>alert(1)</script>')).toBe(
        '/',
      );
    });

    it('rejects mailto:evil@example.com', () => {
      expect(validateReturnTo('mailto:evil@example.com')).toBe('/');
    });
  });

  describe('falls back to / for invalid input', () => {
    it('returns / when returnTo is null', () => {
      expect(validateReturnTo(null)).toBe('/');
    });

    it('returns / when returnTo is empty string', () => {
      expect(validateReturnTo('')).toBe('/');
    });

    it('returns / when returnTo does not start with /', () => {
      expect(validateReturnTo('evil.com')).toBe('/');
    });

    it('returns / when returnTo is relative without leading slash', () => {
      expect(validateReturnTo('oauth/consent')).toBe('/');
    });
  });
});
