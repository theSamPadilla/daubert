// backend/src/modules/export/formats/tx.ts
//
// Texas unsworn declaration under Tex. Civ. Prac. & Rem. Code § 132.001.
//
// TODO fidelity pass: needs a reference filing. § 132.001(d) prescribes a jurat
// that recites the declarant's name, date of birth, and address; the language
// below tracks the statute, but the caption/layout chrome is best-effort
// (reuses the generic non-gutter base) and has NOT been checked against a filed
// Texas declaration. Revisit before treating this as filing-ready.

import { escapeHtml } from '../templates/util';
import { DeclarationData } from '../../productions/declaration-data';
import { DeclarationFormat } from './format';
import {
  renderGenericCaption,
  genericSignatureBlock,
  genericNonGutterStyles,
} from './generic';

function txOpening(declarantName: string): string {
  return `<div class="oath-open"><div class="oath-line">I, ${escapeHtml(
    declarantName,
  )}, declare as follows:</div></div>`;
}

// Tex. Civ. Prac. & Rem. Code § 132.001(d): the jurat recites name, DOB, and
// address before the penalty-of-perjury statement. DOB/address come from the
// execution/declarant fields required by requiredDeclarantFields.
function txClosing(data: DeclarationData): string {
  const date = escapeHtml(data.execution.date || '');
  const place = escapeHtml(data.execution.place || '');
  const name = escapeHtml(data.execution.signatureName || data.declarantName || '');
  const dob = escapeHtml(data.declarantDateOfBirth || '');
  const address = escapeHtml(data.declarantAddress || place);
  return `<div class="execution">
    <p class="perjury">My name is ${name}, my date of birth is ${dob}, and my address is ${address}. I declare under penalty of perjury that the foregoing is true and correct.</p>
    <p class="dated">Executed on ${date}.</p>
    ${genericSignatureBlock(data)}
  </div>`;
}

export const txFormat: DeclarationFormat = {
  id: 'tx-declaration',
  label: 'Texas: Unsworn Declaration (§ 132.001)',
  jurisdiction: 'TX',
  description:
    'Texas unsworn declaration under Tex. Civ. Prac. & Rem. Code § 132.001. Jurat recites declarant name, date of birth, and address. Best-effort layout pending a reference filing.',
  pleadingGutter: false,
  pageFormat: 'Letter',
  requiredDeclarantFields: ['dateOfBirth', 'address'],
  renderCaption: (data) => renderGenericCaption(data, 'Cause No.'),
  renderOathOpening: (data) => txOpening(data.declarantName),
  renderClosing: txClosing,
  styles: genericNonGutterStyles,
};
