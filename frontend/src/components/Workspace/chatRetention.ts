// Mirrors CHAT_RETENTION_DAYS in the backend chat-retention service. Keep in sync.
export const CHAT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days until the oldest message in a conversation is purged
 * (floor, never negative; 0 means today). Null when there is no date.
 */
export function daysUntilPurge(oldestMessageAt: string | null, now: Date = new Date()): number | null {
  if (!oldestMessageAt) return null;
  const oldest = new Date(oldestMessageAt).getTime();
  if (Number.isNaN(oldest)) return null;
  const remaining = oldest + CHAT_RETENTION_DAYS * DAY_MS - now.getTime();
  return Math.max(0, Math.floor(remaining / DAY_MS));
}

/** Muted history-row copy for conversations close to the purge window. */
export function purgeNotice(days: number): string {
  if (days === 0) return 'Oldest messages deleted today';
  return `Oldest messages deleted in ${days} ${days === 1 ? 'day' : 'days'}`;
}
