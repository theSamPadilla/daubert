// backend/src/modules/export/formats/fl.ts
//
// Florida declaration / verification under Fla. Stat. § 92.525.
//
// TODO fidelity pass: needs a reference filing. The oath language below tracks
// § 92.525(2), but the caption/layout chrome is best-effort (reuses the generic
// non-gutter base) and has NOT been checked against a filed Florida declaration.
// Revisit before treating this as filing-ready.

import { escapeHtml } from '../templates/util';
import { DeclarationData } from '../../productions/declaration-data';
import { DeclarationFormat } from './format';
import {
  renderGenericCaption,
  genericSignatureBlock,
  genericNonGutterStyles,
} from './generic';

function flOpening(declarantName: string): string {
  return `<div class="oath-open"><div class="oath-line">I, ${escapeHtml(
    declarantName,
  )}, declare as follows:</div></div>`;
}

// Fla. Stat. § 92.525(2): the written declaration form.
function flClosing(data: DeclarationData): string {
  const date = escapeHtml(data.execution.date || '');
  return `<div class="execution">
    <p class="perjury">Under penalties of perjury, I declare that I have read the foregoing and that the facts stated in it are true.</p>
    <p class="dated">Executed on ${date}.</p>
    ${genericSignatureBlock(data)}
  </div>`;
}

export const flFormat: DeclarationFormat = {
  id: 'fl-declaration',
  label: 'Florida — Declaration (§ 92.525)',
  jurisdiction: 'FL',
  description:
    'Florida written declaration under penalties of perjury pursuant to Fla. Stat. § 92.525. Best-effort layout pending a reference filing.',
  pleadingGutter: false,
  pageFormat: 'Letter',
  requiredDeclarantFields: [],
  renderCaption: (data) => renderGenericCaption(data, 'Case No.'),
  renderOathOpening: (data) => flOpening(data.declarantName),
  renderClosing: flClosing,
  styles: genericNonGutterStyles,
};
