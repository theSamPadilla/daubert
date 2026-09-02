import { TronscanProvider } from './tronscan.provider';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';

const TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function makeProvider(): TronscanProvider {
  return new TronscanProvider(
    'test-key',
    new RateLimiter(1000, 1000),
    new ResponseCache(),
  );
}

describe('TronscanProvider', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('classifyAddress', () => {
    // Tronscan cannot answer the question the shared table records, so it says
    // so rather than recording a guess as a permanent fact.
    it('reports undetermined without calling the API', async () => {
      const result = await makeProvider().classifyAddress(TRON_ADDRESS);

      expect(result.determined).toBe(false);
      expect(result.classification.addressType).toBe('wallet');
      expect(result.classification.tokenStandard).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
