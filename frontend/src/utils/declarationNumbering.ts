import type { components } from '../generated/api-types';

type DeclarationData = components['schemas']['DeclarationData'];

export interface DeclarationNumbering {
  /** Section id → letter, e.g. 'A.', 'B.', 'C.' — in section array order. */
  sectionLetters: Map<string, string>;
  /** Paragraph id → number, continuous across all sections, starting at 1. */
  paragraphNumbers: Map<string, number>;
  /** Footnote id → number, in document order (section → paragraph → footnote). */
  footnoteNumbers: Map<string, number>;
}

/** Section letter for index i: A, B, ..., Z, AA, AB, ... (bijective base-26). */
function sectionLetterForIndex(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}.`;
}

/**
 * Computes the render numbering for a declaration: section letters, continuous
 * paragraph numbers, and document-order footnote numbers. Pure function — no
 * side effects. Iterates sections in array order, paragraphs within each
 * section, and footnotes within each paragraph.
 */
export function computeDeclarationNumbering(data: DeclarationData): DeclarationNumbering {
  const sectionLetters = new Map<string, string>();
  const paragraphNumbers = new Map<string, number>();
  const footnoteNumbers = new Map<string, number>();

  let paragraphCounter = 0;
  let footnoteCounter = 0;

  data.sections.forEach((section, sectionIndex) => {
    sectionLetters.set(section.id, sectionLetterForIndex(sectionIndex));

    for (const paragraph of section.paragraphs) {
      paragraphCounter += 1;
      paragraphNumbers.set(paragraph.id, paragraphCounter);

      for (const fn of paragraph.footnotes) {
        footnoteCounter += 1;
        footnoteNumbers.set(fn.id, footnoteCounter);
      }
    }
  });

  return { sectionLetters, paragraphNumbers, footnoteNumbers };
}
