import DOMPurify from 'isomorphic-dompurify';
import { CSP_META } from './styles';
import { escapeHtml, sanitizeUrl } from './util';
import {
  DeclarationData,
  DeclarationExhibit,
  DeclarationParagraph,
  DeclarationSection,
} from '../../productions/declaration-data';
import { getFormat, DEFAULT_FORMAT_ID } from '../formats/registry';
import { DeclarationFormat, pleadingGutterHtml } from '../formats/format';

/**
 * Resolve the effective format id for a declaration. `formatId` is canonical;
 * `variant` is the deprecated back-compat field carried by existing prod rows;
 * unset falls back to the CA declaration.
 */
export function resolveFormatId(data: DeclarationData): string {
  return (
    (data.formatId as string | undefined) ??
    (data.variant as string | undefined) ??
    DEFAULT_FORMAT_ID
  );
}

export interface DeclarationRenderOptions {
  /**
   * When true, omit fixed/absolutely-positioned pleading chrome (line-number
   * gutter, vertical rules, per-page footer) so the HTML survives the
   * html-to-docx conversion, which can't honour position:fixed. The body,
   * caption, oath, paragraphs, endnotes and exhibit index still render.
   */
  docx?: boolean;
}

/**
 * Sanitize declaration paragraph / sub-item / footnote text. Only inline
 * emphasis (<b>/<i>/<u>) is allowed through; everything else is escaped/stripped.
 * DOMPurify also normalises <strong>→(kept) and strips attributes, so we
 * restrict to the bare emphasis tags to keep court output clean.
 */
function sanitizeInline(text: string): string {
  return DOMPurify.sanitize(text ?? '', {
    ALLOWED_TAGS: ['b', 'i', 'u'],
    ALLOWED_ATTR: [],
  });
}

/** Look up an exhibit label by id; returns null if the exhibit no longer exists. */
function exhibitLabel(exhibitId: string, byId: Map<string, DeclarationExhibit>): string | null {
  const ex = byId.get(exhibitId);
  return ex ? ex.label : null;
}

/**
 * Render the "See Exhibit X." / "See Exhibits X, Y." trailer appended to a
 * paragraph. Labels are bold+underlined to match the reference filings.
 * Dangling refs (exhibit since deleted) are dropped rather than printing the
 * raw id — if none of the refs resolve, no exhibit-ref text is rendered.
 */
function renderExhibitRefs(
  exhibitIds: string[],
  byId: Map<string, DeclarationExhibit>,
): string {
  const labels = exhibitIds
    .map((id) => exhibitLabel(id, byId))
    .filter((l): l is string => l !== null && l.length > 0);
  if (labels.length === 0) return '';
  const rendered = labels
    .map((l) => `<b><u>${escapeHtml(l)}</u></b>`)
    .join(', ');
  const word = labels.length === 1 ? 'Exhibit' : 'Exhibits';
  return ` See ${word} ${rendered}.`;
}

interface EndnoteEntry {
  marker: number;
  html: string; // sanitized inline html
}

/**
 * Render one numbered paragraph. Footnotes are collected into `endnotes`
 * (document order) and replaced in-text by a superscript marker. Sub-items
 * render as an a./b./c. indented list. Exhibit refs are appended to the text.
 */
function renderParagraph(
  para: DeclarationParagraph,
  paraNumber: number,
  byId: Map<string, DeclarationExhibit>,
  endnotes: EndnoteEntry[],
): string {
  let text = sanitizeInline(para.text);

  // Footnote markers (superscript), appended at the end of the paragraph text
  // in document order. Rendered as ENDNOTES before the execution block.
  const markers = (para.footnotes ?? []).map((fn) => {
    const marker = endnotes.length + 1;
    endnotes.push({ marker, html: sanitizeInline(fn.text) });
    return `<sup class="fn-ref">${marker}</sup>`;
  });

  const exhibitRefs = renderExhibitRefs(para.exhibitIds ?? [], byId);
  const body = `${text}${exhibitRefs}${markers.join('')}`;

  const subItems = (para.subItems ?? []).length
    ? `<ol class="sub-items">${(para.subItems ?? [])
        .map((si) => `<li>${sanitizeInline(si.text)}</li>`)
        .join('')}</ol>`
    : '';

  return `<div class="para"><span class="para-num">${paraNumber}.</span>${body}</div>${subItems}`;
}

/** Render one section: lettered, uppercased heading + its numbered paragraphs. */
function renderSection(
  section: DeclarationSection,
  letter: string,
  paraCounter: { n: number },
  byId: Map<string, DeclarationExhibit>,
  endnotes: EndnoteEntry[],
): string {
  const heading = `<div class="section-heading">${escapeHtml(letter)}.&nbsp;&nbsp;${escapeHtml(
    (section.heading ?? '').toUpperCase(),
  )}</div>`;
  const paras = (section.paragraphs ?? [])
    .map((p) => {
      paraCounter.n += 1;
      return renderParagraph(p, paraCounter.n, byId, endnotes);
    })
    .join('');
  return `${heading}${paras}`;
}

function sectionLetter(index: number): string {
  // A, B, ... Z, AA, AB, ... (spreadsheet-style) — declarations never reach Z
  // in practice, but stay correct if they do.
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Endnotes block, rendered before the execution block when any exist. */
function renderEndnotes(endnotes: EndnoteEntry[]): string {
  if (endnotes.length === 0) return '';
  const items = endnotes
    .map(
      (e) =>
        `<div class="endnote"><span class="endnote-num">${e.marker}</span><span class="endnote-body">${e.html}</span></div>`,
    )
    .join('');
  return `<div class="endnotes"><div class="endnotes-title">ENDNOTES</div>${items}</div>`;
}

/** EXHIBITS index page: label + description + source URL when present. */
function renderExhibitIndex(exhibits: DeclarationExhibit[]): string {
  if (exhibits.length === 0) return '';
  const rows = exhibits
    .map((ex) => {
      const src = ex.source;
      let sourceLine = '';
      if (src?.url) {
        const safe = sanitizeUrl(src.url);
        sourceLine = `<div class="exhibit-source"><a href="${escapeHtml(safe)}">${escapeHtml(src.url)}</a></div>`;
      } else if (src?.txHash) {
        const chain = src.chain ? `${src.chain}: ` : '';
        sourceLine = `<div class="exhibit-source">${escapeHtml(chain)}${escapeHtml(src.txHash)}</div>`;
      } else if (src?.note) {
        sourceLine = `<div class="exhibit-source">${escapeHtml(src.note)}</div>`;
      }
      return `<div class="exhibit-row"><span class="exhibit-label"><b><u>Exhibit ${escapeHtml(ex.label)}</u></b></span><span class="exhibit-desc">${escapeHtml(ex.description)}${sourceLine}</span></div>`;
    })
    .join('');
  return `<div class="exhibit-index"><div class="exhibit-index-title">EXHIBITS</div>${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function commonStyles(): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; color: #000; font-size: 12pt; }
  .section-heading { font-weight: bold; text-transform: uppercase; margin: 12pt 0 8pt; }
  .doc-title { font-weight: bold; }
  .oath-preamble { font-weight: bold; margin-bottom: 8pt; }
  ol.sub-items { list-style: lower-alpha; margin: 4pt 0 8pt 84pt; }
  ol.sub-items li { margin-bottom: 4pt; text-align: justify; padding-left: 8pt; }
  .fn-ref { font-size: 8pt; vertical-align: super; }
  .endnotes { margin-top: 24pt; }
  .endnotes-title { font-weight: bold; margin-bottom: 8pt; }
  .endnote { display: flex; margin-bottom: 6pt; font-size: 10pt; }
  .endnote-num { min-width: 20pt; vertical-align: super; font-size: 8pt; }
  .endnote-body { flex: 1; }
  .exhibit-index { margin-top: 24pt; page-break-before: always; }
  .exhibit-index-title { font-weight: bold; text-align: center; margin-bottom: 12pt; font-size: 13pt; }
  .exhibit-row { display: flex; margin-bottom: 10pt; }
  .exhibit-label { min-width: 90pt; }
  .exhibit-desc { flex: 1; }
  .exhibit-source { font-size: 10pt; color: #333; word-break: break-all; margin-top: 2pt; }
  .exhibit-source a { color: #000; }
  .signature-block { margin-top: 36pt; margin-left: 55%; }
  .signature-line { border-bottom: 1px solid #000; height: 40pt; }
  .signature-name { padding-top: 2pt; }
  a { color: #000; }
  `;
}

// ---------------------------------------------------------------------------
// Body assembly
// ---------------------------------------------------------------------------

function assembleBody(
  data: DeclarationData,
  format: DeclarationFormat,
): {
  captionHtml: string;
  openingHtml: string;
  sectionsHtml: string;
  endnotesHtml: string;
  closingHtml: string;
  exhibitIndexHtml: string;
} {
  const byId = new Map<string, DeclarationExhibit>();
  for (const ex of data.exhibits ?? []) byId.set(ex.id, ex);

  const endnotes: EndnoteEntry[] = [];
  const paraCounter = { n: 0 };
  const sectionsHtml = (data.sections ?? [])
    .map((section, i) =>
      renderSection(section, sectionLetter(i), paraCounter, byId, endnotes),
    )
    .join('');

  return {
    captionHtml: format.renderCaption(data),
    openingHtml: format.renderOathOpening(data),
    sectionsHtml,
    endnotesHtml: renderEndnotes(endnotes),
    closingHtml: format.renderClosing(data),
    exhibitIndexHtml: renderExhibitIndex(data.exhibits ?? []),
  };
}

/**
 * Render a declaration to a full HTML document. The jurisdiction format
 * (resolved from `formatId`/`variant`) supplies the caption, oath, closing,
 * styles and optional per-page footer; the shared engine here supplies the
 * paragraph/section/endnote/exhibit body. Pass `{ docx: true }` to omit fixed
 * pleading chrome (the CA line-number gutter) so the HTML survives
 * html-to-docx conversion.
 *
 * Pleading-gutter formats rely on the export controller passing a per-page
 * footer via the Puppeteer `footerTemplate` option (see ExportService.htmlToPdf
 * and buildDeclarationFooterTemplate).
 */
export function renderDeclarationHtml(
  data: DeclarationData,
  opts?: DeclarationRenderOptions,
): string {
  const format = getFormat(resolveFormatId(data));
  const docx = opts?.docx ?? false;
  const parts = assembleBody(data, format);

  const title = escapeHtml(data.caption?.documentTitle || 'Declaration');

  const variantCss = format.styles();
  // The fixed gutter is pleading chrome that html-to-docx can't honour.
  const gutterHtml = format.pleadingGutter && !docx ? pleadingGutterHtml() : '';

  const body = `${gutterHtml}
  <div class="doc-body">
    ${parts.captionHtml}
    ${parts.openingHtml}
    ${parts.sectionsHtml}
    ${parts.endnotesHtml}
    ${parts.closingHtml}
    ${parts.exhibitIndexHtml}
  </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${title}</title>
<style>${commonStyles()}${variantCss}</style>
</head><body>${body}</body></html>`;
}

/**
 * Per-page footer template for a declaration's PDF, delegated to the resolved
 * format. Only pleading-gutter formats (currently CA) define a footer; others
 * return an empty string. The export controller feeds this to Puppeteer's
 * `footerTemplate` option.
 */
export function buildDeclarationFooterTemplate(data: DeclarationData): string {
  const format = getFormat(resolveFormatId(data));
  return format.footerTemplate ? format.footerTemplate(data) : '';
}
