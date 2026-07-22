// backend/src/modules/export/formats/format.ts
//
// The DeclarationFormat contract: everything that varies by jurisdiction is
// behind this interface. The shared render engine (paragraphs, sections,
// endnotes, exhibit index, common styles) lives in ../templates/declaration.ts
// and is jurisdiction-agnostic; formats only supply caption, oath, closing,
// styles, and optional per-page footer.
//
// This module also hosts the small caption/pleading primitives shared by the
// format modules (renderAttorneyBlock, pleading-paper geometry). They live here
// rather than in declaration.ts to avoid a circular import: declaration.ts ->
// registry.ts -> the format modules -> back to declaration.ts.

import { escapeHtml } from '../templates/util';
import { DeclarationData } from '../../productions/declaration-data';

/**
 * The pleading-paper "line unit". ONE variable drives both the CA line-number
 * gutter spacing and the body line-height, so the numbers stay aligned to text
 * lines regardless of font. If you change this, both stay in lockstep.
 */
export const PLEADING_LINE = '24px';
export const PLEADING_LINES = 28; // standard CA pleading paper: 28 numbered lines

export interface DeclarationFormat {
  /** Stable id — matches DeclarationFormatId in the contracts. */
  id: string;
  /** Human label for pickers, e.g. "California — Declaration (pleading paper)". */
  label: string;
  /** Short jurisdiction tag, e.g. "CA", "NY", "Federal", "TX", "FL". */
  jurisdiction: string;
  /** One-line description of when to use this format. */
  description: string;
  /** Whether this format renders the CA-style numbered pleading line gutter. */
  pleadingGutter: boolean;
  /** Print page format the PDF/DOCX targets. */
  pageFormat: 'A4' | 'Letter';
  /** Declarant fields this format's body requires (drives editor validation). */
  requiredDeclarantFields: Array<'dateOfBirth' | 'address'>;

  /** Caption/header block (court, parties, case number, document title). */
  renderCaption(data: DeclarationData): string;
  /** Opening oath / "I, X, declare:" line. */
  renderOathOpening(data: DeclarationData): string;
  /** Closing perjury attestation + signature block. */
  renderClosing(data: DeclarationData): string;
  /** Format-specific CSS appended after the common styles. */
  styles(): string;
  /**
   * Puppeteer per-page footer template (pleading-paper page-number footer).
   * Only pleading-gutter formats define this; others omit it.
   */
  footerTemplate?(data: DeclarationData): string;
}

/** Attorney block: preserve author's line breaks, escape each line. */
export function renderAttorneyBlock(raw: string): string {
  const lines = (raw || '')
    .split('\n')
    .map((l) => escapeHtml(l))
    .join('<br>');
  return `<div class="attorney-block">${lines}</div>`;
}

/**
 * The fixed pleading-paper line-number gutter markup. Shared so any future
 * pleading-gutter format reuses the exact same chrome the CA format emits.
 */
export function pleadingGutterHtml(): string {
  const gutterNumbers = Array.from({ length: PLEADING_LINES }, (_, i) => i + 1)
    .map((n) => `<div class="ln">${n}</div>`)
    .join('');
  return `<div class="pleading-gutter"><div class="rule-outer"></div><div class="rule-inner"></div>${gutterNumbers}</div>`;
}
