/**
 * Publishes docs/guide/index.html into the marketing site as /guide.
 *
 * The print HTML stays the source of truth. This script derives the web
 * variant from it so there is only ever one copy of the words:
 *
 *   - lifts the <style> block and the <body> markup out of index.html
 *   - rewrites body{} to .guide-root{} so the guide's typography cannot
 *     leak onto the rest of the site through the shared <body>
 *   - repoints assets/… at /guide/assets/… (served from public/)
 *   - gives every .sheet an id and turns the contents rows into anchors,
 *     because printed page numbers mean nothing in a scrolling page
 *   - copies the screenshots and the PDF into the site's public/
 *
 * Output is a .ts module rather than a file read at runtime: webpack bundles
 * it, so there is nothing for Vercel's output tracing to miss.
 *
 * Usage:  node docs/guide/build-web.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', '..', '..', 'website-daubert');

if (!existsSync(SITE)) {
  console.error(`website-daubert not found at ${SITE}`);
  process.exit(1);
}

const src = readFileSync(join(HERE, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

const styleMatch = src.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = src.match(/<body>([\s\S]*?)<\/body>/);
if (!styleMatch || !bodyMatch) {
  console.error('Could not find <style> or <body> in index.html');
  process.exit(1);
}

let css = styleMatch[1];
let html = bodyMatch[1];

// ---------------------------------------------------------------------------
// CSS: contain it
// ---------------------------------------------------------------------------

// The print sheet styles `body` directly. On the site that body is shared with
// the site's own chrome, so scope it to the guide's own wrapper instead.
css = css.replace(
  /^body\{\n\s*margin:0;[\s\S]*?\n\}/m,
  `.guide-root{
  color:var(--ink);
  font-family:var(--sans); font-size:10.5pt; line-height:1.55;
  -webkit-font-smoothing:antialiased;
}`,
);

// `@media screen` in the print file paints the page-drop-shadow look. The web
// build lays the guide out as one continuous column, so drop that block.
css = css.replace(/@media screen\{[\s\S]*?\n\}\n/, '');

// ---------------------------------------------------------------------------
// HTML: ids, anchors, asset paths
// ---------------------------------------------------------------------------

html = html.replace(/src="assets\//g, 'src="/guide/assets/');

// Give each sheet a stable id.
//
// Derived from the section number printed in the heading, not from the sheet's
// position, because they diverge: the BYOA section runs onto a second sheet
// that carries no number of its own. Numbering by position made the contents'
// last row land on that continuation page instead of the final section.
let sheetIndex = 0;
let continuation = 0;
html = html.replace(
  /<section class="sheet( cover)?">([\s\S]*?)(?=<section class="sheet|$)/g,
  (whole, cover, inner) => {
    let id;
    if (sheetIndex === 0) id = 'top';
    else if (sheetIndex === 1) id = 'contents';
    else {
      const num = inner.match(/<span class="num">(\d+)<\/span>/);
      id = num ? `sec-${num[1]}` : `cont-${(continuation += 1)}`;
    }
    sheetIndex += 1;
    return whole.replace(
      /^<section class="sheet( cover)?">/,
      `<section class="sheet${cover || ''}" id="${id}">`,
    );
  },
);

// Contents rows become links. The printed page number stays in the markup so
// the same file still prints correctly; guide.css hides it on screen.
let tocRow = 0;
html = html.replace(
  /<li>\n(\s*)<span class="tn">(\d+)<\/span>/g,
  (_m, indent, num) => {
    tocRow += 1;
    return `<li data-target="sec-${num}">\n${indent}<span class="tn">${num}</span>`;
  },
);

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const outDir = join(SITE, 'src', 'app', 'guide');
mkdirSync(outDir, { recursive: true });

const banner = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by daubert/docs/guide/build-web.mjs from docs/guide/index.html.
 * Edit the guide there and re-run that script.
 */\n\n`;

writeFileSync(
  join(outDir, 'content.ts'),
  banner +
    `export const GUIDE_CSS = ${JSON.stringify(css)};\n\n` +
    `export const GUIDE_HTML = ${JSON.stringify(html)};\n`,
);

const publicDir = join(SITE, 'public', 'guide');
mkdirSync(publicDir, { recursive: true });
cpSync(join(HERE, 'assets'), join(publicDir, 'assets'), { recursive: true });

const pdf = join(HERE, 'daubert-expert-guide.pdf');
if (existsSync(pdf)) cpSync(pdf, join(publicDir, 'daubert-expert-guide.pdf'));

console.log(`guide -> ${outDir}/content.ts`);
console.log(`  sheets: ${sheetIndex}, contents rows: ${tocRow}`);
console.log(`  assets -> ${publicDir}/assets`);
