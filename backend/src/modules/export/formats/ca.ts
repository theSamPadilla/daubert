// backend/src/modules/export/formats/ca.ts
//
// California declaration on pleading paper. Extracted VERBATIM from the original
// declaration.ts renderer (plan Task A2). The strings and CSS here are locked by
// the CA parity snapshot in declaration.spec.ts — do not alter without a
// deliberate re-snapshot.

import { escapeHtml } from '../templates/util';
import { DeclarationData } from '../../productions/declaration-data';
import {
  DeclarationFormat,
  PLEADING_LINE,
  PLEADING_LINES,
  renderAttorneyBlock,
} from './format';

function caOpening(declarantName: string): string {
  return `<div class="oath-open"><div class="oath-preamble">TO ALL PARTIES AND TO THEIR ATTORNEYS OF RECORD:</div><div class="oath-line">I, ${escapeHtml(declarantName)}, declare:</div></div>`;
}

function caClosing(data: DeclarationData): string {
  const place = escapeHtml(data.execution.place || '');
  const date = escapeHtml(data.execution.date || '');
  const sig = escapeHtml(data.execution.signatureName || data.declarantName || '');
  return `<div class="execution">
    <p class="perjury">I declare under penalty of perjury under the laws of the State of California that the foregoing is true and correct. Executed ${date}, at ${place}.</p>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-name">${sig}</div>
    </div>
  </div>`;
}

/** CA caption: court/county centered header, then caption box left + case info right. */
function renderCaCaption(data: DeclarationData): string {
  const c = data.caption;
  return `
  ${renderAttorneyBlock(c.attorneyBlock)}
  <div class="ca-court-header">
    <div>${escapeHtml(c.court)}</div>
    <div>${escapeHtml(c.county)}</div>
  </div>
  <div class="ca-caption">
    <div class="ca-caption-box">
      <div class="cap-party">${escapeHtml(c.plaintiff)},</div>
      <div class="cap-role">Plaintiff,</div>
      <div class="cap-vs">vs.</div>
      <div class="cap-party">${escapeHtml(c.defendant)},</div>
      <div class="cap-role">Defendant.</div>
    </div>
    <div class="ca-caption-info">
      <div class="case-no">Case No. ${escapeHtml(c.caseNumber)}</div>
      <div class="doc-title">${escapeHtml(c.documentTitle)}</div>
      ${c.hearingInfo ? `<div class="hearing-info">${escapeHtml(c.hearingInfo).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
  </div>`;
}

/**
 * CA pleading-paper styles. A position:fixed gutter repeats on every printed
 * page in Puppeteer. Body line-height is locked to --pleading-line so text
 * lines align with the gutter numbers.
 *
 * Geometry note: the export controller sets Puppeteer page margins to
 * { top: 0.5in, bottom: 0.75in, left: 0.4in, right: 0.5in }. The fixed gutter
 * is positioned at top/left 0 of that content frame, and the body is padded
 * left to clear it. The gutter's own top offset is 0 so line 1 aligns with
 * the first body line.
 */
function caStyles(): string {
  return `
  :root { --pleading-line: ${PLEADING_LINE}; --gutter-w: 0.55in; }
  body { line-height: var(--pleading-line); }
  .doc-body { padding-left: var(--gutter-w); }
  /* Fixed gutter: repeats on every printed page (position:fixed prints on
     every page in Chromium). Top/left 0 = top-left of the content frame. */
  .pleading-gutter {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--gutter-w);
    height: calc(var(--pleading-line) * ${PLEADING_LINES});
  }
  .pleading-gutter .rule-inner { position: absolute; top: 0; bottom: 0; right: 6pt; border-left: 1px solid #000; }
  .pleading-gutter .rule-outer { position: absolute; top: 0; bottom: 0; right: 9pt; border-left: 1px solid #000; }
  .pleading-gutter .ln {
    height: var(--pleading-line);
    line-height: var(--pleading-line);
    text-align: right;
    padding-right: 16pt;
    font-size: 11pt;
  }
  .attorney-block { line-height: var(--pleading-line); margin-bottom: 0; }
  .ca-court-header { text-align: center; font-weight: bold; line-height: var(--pleading-line); margin: 0; }
  .ca-caption { display: flex; margin: 0 0 var(--pleading-line); line-height: var(--pleading-line); }
  .ca-caption-box { width: 50%; border-right: 1px solid #000; padding-right: 12pt; min-height: calc(var(--pleading-line) * 11); }
  .ca-caption-box .cap-role { text-align: center; }
  .ca-caption-box .cap-vs { margin-left: 24pt; }
  .ca-caption-info { width: 50%; padding-left: 18pt; }
  .ca-caption-info .doc-title { margin-bottom: var(--pleading-line); }
  .oath-line { text-indent: 48pt; text-align: justify; }
  .oath-preamble { font-weight: bold; }
  .section-heading { margin: 0; line-height: var(--pleading-line); }
  .para { text-indent: 48pt; text-align: justify; }
  .para-num { display: inline-block; text-indent: 0; min-width: 36pt; }
  ol.sub-items { line-height: var(--pleading-line); margin: 0 0 0 84pt; }
  .execution { margin-top: var(--pleading-line); }
  .perjury { text-align: justify; }
  `;
}

/**
 * Puppeteer footer template for the CA pleading footer: centered page number
 * over the document title. Puppeteer footer templates run in an isolated
 * context with tiny default font, so styles MUST be inline and font-size
 * explicit.
 */
function caFooterTemplate(data: DeclarationData): string {
  const title = escapeHtml(data.caption?.documentTitle || '');
  return `<div style="width:100%;font-family:'Times New Roman',serif;font-size:9pt;color:#000;padding:0 0.75in;">
    <div style="text-align:center;">- <span class="pageNumber"></span> -</div>
    <div style="text-align:center;border-top:1px solid #000;padding-top:2px;margin-top:2px;">${title}</div>
  </div>`;
}

export const caFormat: DeclarationFormat = {
  id: 'ca-declaration',
  label: 'California — Declaration (pleading paper)',
  jurisdiction: 'CA',
  description:
    'California pleading-paper declaration with numbered line gutter and per-page footer. Executed under CCP § 2015.5.',
  pleadingGutter: true,
  pageFormat: 'Letter',
  requiredDeclarantFields: [],
  renderCaption: renderCaCaption,
  renderOathOpening: (data) => caOpening(data.declarantName),
  renderClosing: caClosing,
  styles: caStyles,
  footerTemplate: caFooterTemplate,
};
