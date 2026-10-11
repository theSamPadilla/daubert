import { daysUntilPurge, purgeNotice } from './chatRetention';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-11T12:00:00.000Z');
const oldestAgo = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

describe('daysUntilPurge', () => {
  it('returns null when there is no date', () => {
    expect(daysUntilPurge(null, now)).toBeNull();
  });

  it('counts whole days left in the 30 day window', () => {
    expect(daysUntilPurge(oldestAgo(22), now)).toBe(8);
    expect(daysUntilPurge(oldestAgo(23), now)).toBe(7);
    expect(daysUntilPurge(oldestAgo(23.5), now)).toBe(6);
  });

  it('returns 0 on the last day and never goes negative', () => {
    expect(daysUntilPurge(oldestAgo(29.5), now)).toBe(0);
    expect(daysUntilPurge(oldestAgo(30), now)).toBe(0);
    expect(daysUntilPurge(oldestAgo(45), now)).toBe(0);
  });
});

describe('purgeNotice', () => {
  it('handles today, singular and plural', () => {
    expect(purgeNotice(0)).toBe('Oldest messages deleted today');
    expect(purgeNotice(1)).toBe('Oldest messages deleted in 1 day');
    expect(purgeNotice(7)).toBe('Oldest messages deleted in 7 days');
  });
});
