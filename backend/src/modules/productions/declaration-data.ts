// backend/src/modules/productions/declaration-data.ts

import { randomUUID } from 'crypto';
import { hasFormat, DEFAULT_FORMAT_ID } from '../export/formats/registry';

/**
 * Canonical set of jurisdiction format ids. Kept in lockstep with
 * DeclarationFormatId in the contracts and the export format registry.
 */
export type DeclarationFormatId =
  | 'ca-declaration'
  | 'ny-affirmation'
  | 'federal-1746'
  | 'tx-declaration'
  | 'fl-declaration';

/** @deprecated Use DeclarationFormatId. Retained for existing prod rows. */
export type DeclarationVariant = 'ca-declaration' | 'ny-affirmation';

export interface DeclarationCaption {
  attorneyBlock: string;
  court: string;
  county: string;
  plaintiff: string;
  defendant: string;
  caseNumber: string;
  documentTitle: string;
  hearingInfo: string;
}

export interface DeclarationSubItem {
  id: string;
  text: string;
}

export interface DeclarationFootnote {
  id: string;
  text: string;
}

export interface DeclarationParagraph {
  id: string;
  text: string;
  subItems: DeclarationSubItem[];
  exhibitIds: string[];
  footnotes: DeclarationFootnote[];
}

export type DeclarationSectionKind =
  | 'qualifications'
  | 'assignment'
  | 'summary_of_opinions'
  | 'background'
  | 'authentication'
  | 'findings'
  | 'conclusions'
  | 'recommendations'
  | 'custom';

export interface DeclarationSection {
  id: string;
  kind: DeclarationSectionKind;
  heading: string;
  paragraphs: DeclarationParagraph[];
}

export interface DeclarationExhibitSource {
  kind: 'transaction' | 'url' | 'file' | 'other';
  txHash?: string;
  chain?: string;
  url?: string;
  note?: string;
}

export interface DeclarationExhibit {
  id: string;
  label: string;
  description: string;
  source: DeclarationExhibitSource | null;
}

export interface DeclarationExecution {
  place: string;
  date: string;
  signatureName: string;
}

export interface DeclarationData {
  schemaVersion: 1;
  /** Canonical jurisdiction format id. Preferred over the deprecated `variant`. */
  formatId?: DeclarationFormatId;
  /** @deprecated Back-compat alias for `formatId` on existing rows. */
  variant?: DeclarationVariant;
  caption: DeclarationCaption;
  declarantName: string;
  /** Declarant DOB. Required only by formats that list it in requiredDeclarantFields (e.g. TX). */
  declarantDateOfBirth?: string;
  /** Declarant address. Required only by formats that list it in requiredDeclarantFields (e.g. TX). */
  declarantAddress?: string;
  sections: DeclarationSection[];
  exhibits: DeclarationExhibit[];
  execution: DeclarationExecution;
}

export function seedDeclarationData(input: Partial<DeclarationData> | undefined): DeclarationData {
  // `formatId` is canonical; `variant` is the deprecated back-compat field.
  // Take whichever the caller supplied, validate it against the registry, and
  // fall back to CA for unknown/absent ids. We write `formatId` only — new rows
  // no longer carry `variant`.
  const requested = input?.formatId ?? input?.variant;
  const formatId: DeclarationFormatId = hasFormat(requested)
    ? (requested as DeclarationFormatId)
    : (DEFAULT_FORMAT_ID as DeclarationFormatId);
  const section = (kind: DeclarationSectionKind, heading: string): DeclarationSection =>
    ({ id: randomUUID(), kind, heading, paragraphs: [] });
  return {
    schemaVersion: 1,
    formatId,
    caption: {
      attorneyBlock: '', court: '', county: '', plaintiff: '', defendant: '',
      caseNumber: '', documentTitle: '', hearingInfo: '',
      ...(input?.caption ?? {}),
    },
    declarantName: input?.declarantName ?? '',
    declarantDateOfBirth: input?.declarantDateOfBirth,
    declarantAddress: input?.declarantAddress,
    sections: input?.sections?.length ? input.sections : [
      section('qualifications', 'EXPERT BACKGROUND'),
      section('assignment', 'SCOPE OF REVIEW'),
      section('summary_of_opinions', 'SUMMARY OF OPINIONS'),
      section('background', 'TECHNICAL BACKGROUND'),
      section('findings', 'FINDINGS'),
      section('conclusions', 'CONCLUSIONS'),
    ],
    exhibits: input?.exhibits ?? [],
    execution: { place: '', date: '', signatureName: '', ...(input?.execution ?? {}) },
  };
}

export function nextExhibitLabel(exhibits: DeclarationExhibit[]): string {
  const used = new Set(exhibits.map((e) => e.label));
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  let n = 1;
  while (used.has(`Z${n}`)) n++;
  return `Z${n}`;
}
