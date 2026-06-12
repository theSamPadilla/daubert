/**
 * Shared category constants for labeled entities.
 * Used by /entities (read-only) and /admin/entities (CRUD).
 *
 * The category list mirrors the backend `EntityCategory` enum
 * (`backend/src/database/entities/labeled-entity.entity.ts`). Keep them in sync.
 */

export const CATEGORIES = [
  'exchange',
  'mixer',
  'bridge',
  'protocol',
  'individual',
  'contract',
  'government',
  'custodian',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_COLORS: Record<Category, string> = {
  exchange: 'bg-blue-100 text-blue-700',
  mixer: 'bg-red-100 text-red-700',
  bridge: 'bg-purple-100 text-purple-700',
  protocol: 'bg-green-100 text-green-700',
  individual: 'bg-yellow-100 text-yellow-700',
  contract: 'bg-cyan-100 text-cyan-700',
  government: 'bg-orange-100 text-orange-700',
  custodian: 'bg-indigo-100 text-indigo-700',
  other: 'bg-surface-raised text-ink-muted',
};
