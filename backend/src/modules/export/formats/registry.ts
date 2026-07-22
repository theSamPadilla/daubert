// backend/src/modules/export/formats/registry.ts
//
// The declaration-format registry. All jurisdiction formats register here; the
// renderer and export controller resolve a format by id via getFormat(). Adding
// a new jurisdiction is a matter of dropping a module in ./ and adding one line
// below — no changes to the render engine.

import { DeclarationFormat } from './format';
import { caFormat } from './ca';
import { nyFormat } from './ny';
import { federal1746Format } from './federal-1746';
import { txFormat } from './tx';
import { flFormat } from './fl';

/** The default format used when an id is missing or unrecognized. */
export const DEFAULT_FORMAT_ID = 'ca-declaration';

const FORMATS: DeclarationFormat[] = [
  caFormat,
  nyFormat,
  federal1746Format,
  txFormat,
  flFormat,
];

const REGISTRY: Map<string, DeclarationFormat> = new Map(
  FORMATS.map((f) => [f.id, f]),
);

/** True if `id` names a registered format. */
export function hasFormat(id: string | undefined | null): boolean {
  return id != null && REGISTRY.has(id);
}

/**
 * Resolve a format by id. Unknown/undefined ids fall back to the CA format so
 * existing rows and any future unrecognized id still render something sane.
 */
export function getFormat(id: string | undefined | null): DeclarationFormat {
  const fmt = id != null ? REGISTRY.get(id) : undefined;
  return fmt ?? REGISTRY.get(DEFAULT_FORMAT_ID)!;
}

export interface DeclarationFormatSummary {
  id: string;
  label: string;
  jurisdiction: string;
  description: string;
  pleadingGutter: boolean;
  requiredDeclarantFields: Array<'dateOfBirth' | 'address'>;
}

/** Lightweight summaries for pickers / the formats API. Registration order. */
export function listFormatSummaries(): DeclarationFormatSummary[] {
  return FORMATS.map((f) => ({
    id: f.id,
    label: f.label,
    jurisdiction: f.jurisdiction,
    description: f.description,
    pleadingGutter: f.pleadingGutter,
    requiredDeclarantFields: f.requiredDeclarantFields,
  }));
}
