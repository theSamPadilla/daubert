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
  exchange: 'bg-blue-900/50 text-blue-300',
  mixer: 'bg-red-900/50 text-red-300',
  bridge: 'bg-purple-900/50 text-purple-300',
  protocol: 'bg-green-900/50 text-green-300',
  individual: 'bg-yellow-900/50 text-yellow-300',
  contract: 'bg-cyan-900/50 text-cyan-300',
  government: 'bg-orange-900/50 text-orange-300',
  custodian: 'bg-indigo-900/50 text-indigo-300',
  other: 'bg-gray-700 text-gray-300',
};
