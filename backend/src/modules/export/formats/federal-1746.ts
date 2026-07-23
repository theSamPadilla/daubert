// backend/src/modules/export/formats/federal-1746.ts
//
// Federal unsworn declaration under 28 U.S.C. § 1746 (domestic form).
//
// TODO fidelity pass: needs a reference filing. The oath language below tracks
// the statute verbatim, but the caption/layout chrome is best-effort (reuses the
// generic non-gutter base) and has NOT been checked against a filed federal
// declaration. Revisit before treating this as filing-ready.

import { escapeHtml } from '../templates/util';
import { DeclarationData } from '../../productions/declaration-data';
import { DeclarationFormat } from './format';
import {
  renderGenericCaption,
  genericSignatureBlock,
  genericNonGutterStyles,
} from './generic';

function federalOpening(declarantName: string): string {
  return `<div class="oath-open"><div class="oath-line">I, ${escapeHtml(
    declarantName,
  )}, declare as follows:</div></div>`;
}

// 28 U.S.C. § 1746(2), domestic form.
function federalClosing(data: DeclarationData): string {
  const date = escapeHtml(data.execution.date || '');
  return `<div class="execution">
    <p class="perjury">I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct. Executed on ${date}.</p>
    ${genericSignatureBlock(data)}
  </div>`;
}

export const federal1746Format: DeclarationFormat = {
  id: 'federal-1746',
  label: 'Federal: Unsworn Declaration (28 U.S.C. § 1746)',
  jurisdiction: 'Federal',
  description:
    'Federal unsworn declaration under penalty of perjury pursuant to 28 U.S.C. § 1746. Best-effort layout pending a reference filing.',
  pleadingGutter: false,
  pageFormat: 'Letter',
  requiredDeclarantFields: [],
  renderCaption: (data) => renderGenericCaption(data, 'Case No.'),
  renderOathOpening: (data) => federalOpening(data.declarantName),
  renderClosing: federalClosing,
  styles: genericNonGutterStyles,
};
