/** CSP meta tag — injected into every template <head> to lock down HTML exports opened in browsers. */
export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

export const BASE_STYLES = `
  thead { display: table-header-group; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6; font-size: 11pt; }
  h1 { font-size: 20pt; margin-bottom: 12pt; color: #111; }
  h2 { font-size: 15pt; margin-top: 18pt; margin-bottom: 8pt; color: #222; }
  h3 { font-size: 12pt; margin-top: 14pt; margin-bottom: 6pt; color: #333; }
  p { margin-bottom: 8pt; }
  ul, ol { margin-left: 20pt; margin-bottom: 8pt; }
  a { color: #2563eb; text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16pt; font-size: 10pt; }
  th { background: #f3f4f6; font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; }
  td { padding: 8px 12px; border: 1px solid #d1d5db; vertical-align: top; }
  .citation { color: #2563eb; font-size: 8pt; vertical-align: super; cursor: default; }
  .works-cited { margin-top: 24pt; border-top: 2px solid #d1d5db; padding-top: 16pt; }
  .works-cited h2 { font-size: 14pt; }
  .works-cited li { margin-bottom: 4pt; font-size: 10pt; word-break: break-all; }
  @page { margin: 20mm 15mm; }
  @media print { .no-print { display: none; } }
`;

/** Per-type styles for the chronology template. Must be included when rendering chronology body. */
export const CHRONOLOGY_STYLES = `
  .chronology { table-layout: fixed; }
`;

/** Per-type styles for the chart template. Must be included when rendering chart body. */
export const CHART_STYLES = `
  img.chart-img { max-width: 100%; height: auto; }
`;

/** Per-type styles for the report template. Supplements BASE_STYLES. */
export const REPORT_STYLES = ``;

/** Per-type styles for the graph template. Must be included when rendering graph body. */
export const GRAPH_STYLES = `
  .graph-full-doc body { display: flex; flex-direction: column; align-items: center; }
  .graph-full-doc img { max-width: 100%; height: auto; margin-top: 16pt; }
`;
