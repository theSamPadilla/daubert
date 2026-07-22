import { computeDeclarationNumbering } from './declarationNumbering';
import type { components } from '../generated/api-types';

type DeclarationData = components['schemas']['DeclarationData'];
type DeclarationSection = components['schemas']['DeclarationSection'];
type DeclarationParagraph = components['schemas']['DeclarationParagraph'];
type DeclarationFootnote = components['schemas']['DeclarationFootnote'];

// ── Fixture builders ─────────────────────────────────────────────────────────

function footnote(id: string, overrides: Partial<DeclarationFootnote> = {}): DeclarationFootnote {
  return { id, text: id, ...overrides };
}

function paragraph(id: string, overrides: Partial<DeclarationParagraph> = {}): DeclarationParagraph {
  return {
    id,
    text: id,
    subItems: [],
    exhibitIds: [],
    footnotes: [],
    ...overrides,
  };
}

function section(id: string, overrides: Partial<DeclarationSection> = {}): DeclarationSection {
  return {
    id,
    kind: 'custom',
    heading: id,
    paragraphs: [],
    ...overrides,
  };
}

function declaration(sections: DeclarationSection[]): DeclarationData {
  return {
    schemaVersion: 1,
    variant: 'ca-declaration',
    caption: {
      attorneyBlock: '', court: '', county: '', plaintiff: '', defendant: '',
      caseNumber: '', documentTitle: '', hearingInfo: '',
    },
    declarantName: 'Jane Doe',
    sections,
    exhibits: [],
    execution: { place: '', date: '', signatureName: '' },
  };
}

describe('computeDeclarationNumbering', () => {
  it('assigns section letters A., B., C. in array order', () => {
    const data = declaration([
      section('sec-a', { paragraphs: [paragraph('p1'), paragraph('p2')] }),
      section('sec-b', { paragraphs: [paragraph('p3'), paragraph('p4'), paragraph('p5')] }),
      section('sec-c', { paragraphs: [paragraph('p6')] }),
    ]);

    const { sectionLetters } = computeDeclarationNumbering(data);

    expect(sectionLetters.get('sec-a')).toBe('A.');
    expect(sectionLetters.get('sec-b')).toBe('B.');
    expect(sectionLetters.get('sec-c')).toBe('C.');
  });

  it('numbers paragraphs continuously across sections starting at 1', () => {
    const data = declaration([
      section('sec-a', { paragraphs: [paragraph('p1'), paragraph('p2')] }),
      section('sec-b', { paragraphs: [paragraph('p3'), paragraph('p4'), paragraph('p5')] }),
      section('sec-c', { paragraphs: [paragraph('p6')] }),
    ]);

    const { paragraphNumbers } = computeDeclarationNumbering(data);

    expect(paragraphNumbers.get('p1')).toBe(1);
    expect(paragraphNumbers.get('p2')).toBe(2);
    expect(paragraphNumbers.get('p3')).toBe(3);
    expect(paragraphNumbers.get('p4')).toBe(4);
    expect(paragraphNumbers.get('p5')).toBe(5);
    expect(paragraphNumbers.get('p6')).toBe(6);
  });

  it('numbers footnotes in document order across sections and paragraphs', () => {
    const data = declaration([
      section('sec-a', {
        paragraphs: [
          paragraph('p1', { footnotes: [footnote('fn1'), footnote('fn2')] }),
          paragraph('p2', { footnotes: [footnote('fn3')] }),
        ],
      }),
      section('sec-b', { paragraphs: [paragraph('p3'), paragraph('p4'), paragraph('p5')] }),
      section('sec-c', {
        paragraphs: [paragraph('p6', { footnotes: [footnote('fn4'), footnote('fn5')] })],
      }),
    ]);

    const { footnoteNumbers } = computeDeclarationNumbering(data);

    expect(footnoteNumbers.get('fn1')).toBe(1);
    expect(footnoteNumbers.get('fn2')).toBe(2);
    expect(footnoteNumbers.get('fn3')).toBe(3);
    expect(footnoteNumbers.get('fn4')).toBe(4);
    expect(footnoteNumbers.get('fn5')).toBe(5);
  });
});
