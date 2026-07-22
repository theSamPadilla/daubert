// backend/src/modules/export/templates/declaration.spec.ts
//
// PARITY GUARDRAIL for the declaration-format refactor (plan Task A2).
//
// The CA and NY snapshots below are captured against the ORIGINAL, pre-refactor
// renderer. They lock the exact filed-PDF HTML output byte-for-byte. After the
// format-registry refactor these snapshots MUST remain green — any diff means
// the extraction changed CA/NY rendering, which is a regression.
//
// New formats (federal-1746, tx-declaration, fl-declaration) are exercised only
// for smoke coverage (they render, dispatch by formatId, honour resolveFormatId
// precedence). They have no reference filing yet, so we do NOT lock their exact
// bytes — that would freeze best-effort language before a fidelity pass.

import {
  renderDeclarationHtml,
  buildDeclarationFooterTemplate,
  resolveFormatId,
} from './declaration';
import { DeclarationData } from '../../productions/declaration-data';

/**
 * Build a fixed CA/NY sample. Two sections, >=2 paragraphs, an exhibit, a
 * footnote, execution filled — enough to exercise every shared engine path
 * (paragraph, sub-items, exhibit refs, endnotes, exhibit index).
 */
function sample(formatId: string): DeclarationData {
  const isNy = formatId === 'ny-affirmation';
  return {
    schemaVersion: 1,
    // Keep BOTH set to the same value on the CA/NY parity samples so the
    // snapshot is unambiguous regardless of resolution precedence.
    formatId: formatId as DeclarationData['formatId'],
    variant: (isNy ? 'ny-affirmation' : 'ca-declaration') as DeclarationData['variant'],
    caption: {
      attorneyBlock:
        'MATTHEW D. GAUTHIER (State Bar # 325024)\n' +
        'mgauthier@nagylaw.com\n' +
        'NAGY WOLFE APPLETON LLP\n' +
        '31 East 62nd Street\n' +
        'New York, NY 10065\n' +
        'Telephone: (646) 494-4900\n\n' +
        'Attorneys for Defendant STEPHEN AKRIDGE',
      court: isNy
        ? 'SUPREME COURT OF THE STATE OF NEW YORK'
        : 'SUPERIOR COURT OF THE STATE OF CALIFORNIA',
      county: isNy ? 'COUNTY OF NEW YORK' : 'CITY AND COUNTY OF SAN FRANCISCO',
      plaintiff: 'ELISA ROSSI, an individual',
      defendant: 'STEPHEN AKRIDGE, an individual',
      caseNumber: isNy ? '365181/2024' : 'CGC-24-620900',
      documentTitle: isNy
        ? 'AFFIRMATION OF RICHARD WIDMANN IN SUPPORT OF ORDER TO SHOW CAUSE'
        : 'DECLARATION OF RICHARD J. WIDMANN IN SUPPORT OF DEFENDANT’S MOTION FOR SUMMARY JUDGMENT',
      hearingInfo: isNy
        ? ''
        : 'Objection Hearing: February 5, 2026\nTime: 11:30 a.m.\nDept: 302\n\nAction Filed: December 24, 2024\nTrial Date: March 16, 2026',
    },
    declarantName: 'Richard J. Widmann',
    sections: [
      {
        id: 's1',
        kind: 'qualifications',
        heading: 'Expert Background',
        paragraphs: [
          {
            id: 'p1',
            text:
              'I am a founder of Incite Consulting, a crypto-focused litigation consulting firm specializing in regulatory matters, civil and criminal litigation, and investigations concerning cryptocurrency businesses and their executives.',
            subItems: [],
            exhibitIds: [],
            footnotes: [
              {
                id: 'f1',
                text:
                  'Web3 is a term used to describe the recent emergence of cryptocurrency and blockchain technologies.',
              },
            ],
          },
          {
            id: 'p2',
            text:
              'My CV, which I prepared, is attached to this declaration. It reflects my <b>eight years</b> of experience and my role as an <i>adjunct professor</i>.',
            subItems: [],
            exhibitIds: ['e1'],
            footnotes: [],
          },
        ],
      },
      {
        id: 's2',
        kind: 'findings',
        heading: 'Publicly available blockchain records show the transfers',
        paragraphs: [
          {
            id: 'p3',
            text:
              'On March 6, 2024, several transactions occurred involving the following stake accounts:',
            subItems: [
              { id: 'si1', text: '4rF6k3aRX54yhHakGDEbwvPzb36d2PKw688VqchP3bNU' },
              { id: 'si2', text: '7DnNjqbQfv5P4Yb89nA8bvWxwzGC8mqEaupWbYZMNQH' },
              { id: 'si3', text: '5MPGAb9xjdpscnRFBnp4ZCGJrndU6JmMrmbJKqSaLn9i' },
            ],
            exhibitIds: ['e1', 'e2'],
            footnotes: [
              {
                id: 'f2',
                text:
                  'The public key is a unique code or public address that identifies a specific wallet.',
              },
            ],
          },
        ],
      },
    ],
    exhibits: [
      {
        id: 'e1',
        label: 'A',
        description: 'Curriculum Vitae of Richard J. Widmann',
        source: { kind: 'file', note: 'Prepared by declarant' },
      },
      {
        id: 'e2',
        label: 'B1',
        description: 'Solscan record of the March 6, 2024 authority-change transaction',
        source: {
          kind: 'url',
          url: 'https://solscan.io/tx/4rF6k3aRX54yhHakGDEbwvPzb36d2PKw688VqchP3bNU',
        },
      },
    ],
    execution: {
      place: isNy ? 'New York, New York' : 'Austin, Texas',
      date: isNy ? 'November 19, 2025' : 'this 14th day of November 2025',
      signatureName: 'Richard J. Widmann',
    },
  };
}

describe('renderDeclarationHtml — CA/NY parity (byte-for-byte lock)', () => {
  it('CA declaration output is unchanged (screen render, with gutter)', () => {
    expect(renderDeclarationHtml(sample('ca-declaration'))).toMatchSnapshot();
  });

  it('CA declaration output is unchanged (docx render, gutterless)', () => {
    expect(renderDeclarationHtml(sample('ca-declaration'), { docx: true })).toMatchSnapshot();
  });

  it('CA footer template is unchanged', () => {
    expect(buildDeclarationFooterTemplate(sample('ca-declaration'))).toMatchSnapshot();
  });

  it('NY affirmation output is unchanged', () => {
    expect(renderDeclarationHtml(sample('ny-affirmation'))).toMatchSnapshot();
  });

  it('NY affirmation output is unchanged (docx render)', () => {
    expect(renderDeclarationHtml(sample('ny-affirmation'), { docx: true })).toMatchSnapshot();
  });
});

describe('resolveFormatId precedence', () => {
  it('prefers formatId when present', () => {
    expect(resolveFormatId({ formatId: 'tx-declaration', variant: 'ca-declaration' } as any)).toBe(
      'tx-declaration',
    );
  });

  it('falls back to variant when formatId absent (existing prod rows)', () => {
    expect(resolveFormatId({ variant: 'ny-affirmation' } as any)).toBe('ny-affirmation');
  });

  it('defaults to ca-declaration when neither present', () => {
    expect(resolveFormatId({} as any)).toBe('ca-declaration');
  });
});

describe('new formats render (smoke — no fidelity lock)', () => {
  for (const id of ['federal-1746', 'tx-declaration', 'fl-declaration']) {
    it(`${id} renders a full HTML document`, () => {
      const html = renderDeclarationHtml(sample(id));
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Richard J. Widmann');
      // Non-gutter formats must NOT emit the CA pleading gutter.
      expect(html).not.toContain('pleading-gutter');
    });
  }
});
