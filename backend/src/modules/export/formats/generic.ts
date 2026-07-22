// backend/src/modules/export/formats/generic.ts
//
// Shared non-gutter chrome for the best-effort formats (federal-1746, tx, fl).
// Modeled on the NY (non-gutter) layout as a base so these render cleanly today;
// each consuming format still owns its jurisdiction-specific oath/closing/label
// language. When a real reference filing arrives for one of these, that format
// should graduate to its own caption/styles rather than leaning on this base.

import { escapeHtml } from '../templates/util';
import { DeclarationData } from '../../productions/declaration-data';
import { renderAttorneyBlock } from './format';

/**
 * Generic centered caption: court/county header, then a simple two-column
 * parties box (left) + case-number/title (right). Uses the NY (.ny-*) class
 * names so it inherits the shared non-gutter stylesheet below.
 */
export function renderGenericCaption(
  data: DeclarationData,
  caseNumberLabel: string,
): string {
  const c = data.caption;
  return `
  ${c.attorneyBlock ? renderAttorneyBlock(c.attorneyBlock) : ''}
  <div class="ny-court-header">
    <div>${escapeHtml(c.court)}</div>
    <div>${escapeHtml(c.county)}</div>
  </div>
  <div class="ny-caption">
    <div class="ny-caption-box">
      <div class="cap-party">${escapeHtml(c.plaintiff)},</div>
      <div class="cap-role">Plaintiff,</div>
      <div class="cap-against">v.</div>
      <div class="cap-party">${escapeHtml(c.defendant)},</div>
      <div class="cap-role">Defendant.</div>
    </div>
    <div class="ny-caption-info">
      <div class="index-no">${escapeHtml(caseNumberLabel)} ${escapeHtml(c.caseNumber)}</div>
      <div class="doc-title">${escapeHtml(c.documentTitle)}</div>
    </div>
  </div>`;
}

/** Signature block shared by the generic non-gutter closings. */
export function genericSignatureBlock(data: DeclarationData): string {
  const sig = escapeHtml(data.execution.signatureName || data.declarantName || '');
  return `<div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-name">${sig}</div>
    </div>`;
}

/** Non-gutter stylesheet shared by the best-effort formats (mirrors NY chrome). */
export function genericNonGutterStyles(): string {
  return `
  @page { size: Letter; margin: 1in; }
  body { line-height: 2; }
  .ny-court-header { margin-bottom: 8pt; text-align: center; font-weight: bold; }
  .ny-caption { display: flex; align-items: stretch; margin-bottom: 16pt; line-height: 1.5; }
  .ny-caption-box { width: 55%; border: 1px solid #000; padding: 10pt 12pt; }
  .ny-caption-box .cap-role { text-align: center; }
  .ny-caption-box .cap-against { margin-left: 12pt; }
  .ny-caption-info { width: 45%; padding: 10pt 0 10pt 24pt; }
  .ny-caption-info .index-no { margin-bottom: 20pt; }
  .ny-caption-info .doc-title { text-align: center; text-decoration: none; }
  .declarant-facts { margin-bottom: 8pt; }
  .declarant-facts div { text-indent: 0; }
  .oath-open { margin-bottom: 8pt; }
  .oath-line { text-indent: 48pt; text-align: justify; }
  .para { text-indent: 48pt; text-align: justify; }
  .para-num { display: inline-block; text-indent: 0; min-width: 36pt; }
  .attorney-block { margin-bottom: 12pt; line-height: 1.3; }
  .execution { margin-top: 24pt; }
  .perjury { text-align: justify; }
  .dated { white-space: normal; }
  `;
}
