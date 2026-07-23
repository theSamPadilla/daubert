// backend/src/modules/export/formats/ny.ts
//
// New York attorney affirmation (C.P.L.R. § 2106). Extracted VERBATIM from the
// original declaration.ts renderer (plan Task A2). The strings and CSS here are
// locked by the NY parity snapshot in declaration.spec.ts — do not alter without
// a deliberate re-snapshot.

import { escapeHtml } from '../templates/util';
import { DeclarationData } from '../../productions/declaration-data';
import { DeclarationFormat, renderAttorneyBlock } from './format';

function nyOpening(declarantName: string): string {
  return `<div class="oath-open"><div class="oath-line">I, ${escapeHtml(
    declarantName,
  )}, declare under penalty of perjury and pursuant to C.P.L.R. § 2106, that the following is true and correct:</div></div>`;
}

function nyClosing(data: DeclarationData): string {
  const place = escapeHtml(data.execution.place || '');
  const date = escapeHtml(data.execution.date || '');
  const sig = escapeHtml(data.execution.signatureName || data.declarantName || '');
  return `<div class="execution">
    <p class="dated">Dated: ${place}, ${date}</p>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-name">${sig.toUpperCase()}</div>
    </div>
  </div>`;
}

/** NY caption: court/county header, bordered party box left + index/title right. */
function renderNyCaption(data: DeclarationData): string {
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
      <div class="cap-against">- against -</div>
      <div class="cap-party">${escapeHtml(c.defendant)},</div>
      <div class="cap-role">Defendant.</div>
    </div>
    <div class="ny-caption-info">
      <div class="index-no">Index No.: ${escapeHtml(c.caseNumber)}</div>
      <div class="doc-title">${escapeHtml(c.documentTitle)}</div>
    </div>
  </div>`;
}

/** NY-specific styles: no gutter, double-spaced body, first-line-indent paras. */
function nyStyles(): string {
  return `
  @page { size: Letter; margin: 1in; }
  body { line-height: 2; }
  .ny-court-header { margin-bottom: 8pt; }
  .ny-caption { display: flex; align-items: stretch; margin-bottom: 16pt; line-height: 1.5; }
  .ny-caption-box { width: 55%; border: 1px solid #000; padding: 10pt 12pt; }
  .ny-caption-box .cap-role { text-align: center; }
  .ny-caption-box .cap-against { margin-left: 12pt; }
  .ny-caption-info { width: 45%; padding: 10pt 0 10pt 24pt; }
  .ny-caption-info .index-no { margin-bottom: 20pt; }
  .ny-caption-info .doc-title { text-align: center; }
  .ny-caption-info .doc-title { text-decoration: none; }
  .oath-open { margin-bottom: 8pt; }
  .oath-line { text-indent: 48pt; text-align: justify; }
  .para { text-indent: 48pt; text-align: justify; }
  .para-num { display: inline-block; text-indent: 0; min-width: 36pt; }
  .attorney-block { margin-bottom: 12pt; line-height: 1.3; }
  .execution { margin-top: 24pt; }
  .dated { white-space: normal; }
  `;
}

export const nyFormat: DeclarationFormat = {
  id: 'ny-affirmation',
  label: 'New York: Attorney Affirmation (C.P.L.R. § 2106)',
  jurisdiction: 'NY',
  description:
    'New York affirmation under penalty of perjury pursuant to C.P.L.R. § 2106. Double-spaced, bordered caption box, no pleading gutter.',
  pleadingGutter: false,
  pageFormat: 'Letter',
  requiredDeclarantFields: [],
  renderCaption: renderNyCaption,
  renderOathOpening: (data) => nyOpening(data.declarantName),
  renderClosing: nyClosing,
  styles: nyStyles,
};
