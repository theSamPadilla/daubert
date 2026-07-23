/** @jest-environment jsdom */
import { deriveChecklist, isNodeLabeled, readOnboardingRecord, writeOnboardingRecord } from './checklist';

describe('isNodeLabeled', () => {
  it('rejects empty, address-equal, and shortened-address labels', () => {
    expect(isNodeLabeled({ label: '', address: '0xabc' })).toBe(false);
    expect(isNodeLabeled({ label: '0xAbC', address: '0xabc' })).toBe(false);
    expect(isNodeLabeled({ label: '0x1234…abcd', address: '0x1234000000000000000000000000000000abcd' })).toBe(false);
    expect(isNodeLabeled({ label: 'Binance hot wallet', address: '0xabc' })).toBe(true);
  });
});

describe('deriveChecklist', () => {
  const nodes = [{ label: 'Exchange', address: '0xa' }, { label: '', address: '0xb' }];
  it('derives all four steps', () => {
    expect(deriveChecklist({ investigationCount: 1, nodes, seedNodeCount: 1, draftRequested: false }))
      .toEqual({ seeded: true, labeled: true, expanded: true, draftRequested: false });
  });
  it('treats a missing seed baseline as expanded (no nagging for pre-wizard cases)', () => {
    expect(deriveChecklist({ investigationCount: 1, nodes, seedNodeCount: null, draftRequested: false }).expanded).toBe(true);
  });
});

describe('onboarding record', () => {
  it('round-trips through localStorage and defaults to empty', () => {
    expect(readOnboardingRecord('case-x')).toEqual({});
    writeOnboardingRecord('case-x', { seedNodeCount: 5, wizardDismissed: true });
    expect(readOnboardingRecord('case-x')).toEqual({ seedNodeCount: 5, wizardDismissed: true });
  });
});
