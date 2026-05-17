import { LabeledEntitiesService } from '../labeled-entities.service';

describe('LabeledEntitiesService.lookupByAddresses', () => {
  it('returns an empty map for an empty input', async () => {
    const svc = new LabeledEntitiesService({
      createQueryBuilder: () => ({ where: () => ({ getMany: async () => [] }) }),
    } as never);
    const result = await svc.lookupByAddresses([]);
    expect(result.size).toBe(0);
  });

  it('groups results by lowercased address', async () => {
    const fakeRepo = {
      createQueryBuilder: () => ({
        where: () => ({
          getMany: async () => [
            { id: '1', name: 'Tornado', category: 'mixer', wallets: ['0xAAA', '0xBBB'] },
            { id: '2', name: 'Binance', category: 'exchange', wallets: ['0xCCC'] },
          ],
        }),
      }),
    } as never;
    const svc = new LabeledEntitiesService(fakeRepo);
    const result = await svc.lookupByAddresses(['0xaaa', '0xccc', '0xddd']);
    expect(result.get('0xaaa')?.[0]?.name).toBe('Tornado');
    expect(result.get('0xccc')?.[0]?.name).toBe('Binance');
    expect(result.get('0xddd')).toBeUndefined();
  });
});
