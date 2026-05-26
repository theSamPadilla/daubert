import { renderChronologyBody, renderChronologyCsv } from './chronology';
import type { ChronologyData } from '../../productions/chronology-schema';

const baseData: ChronologyData = {
  columns: [
    { key: 'source', label: 'Source', width: 25, kind: 'link' },
    { key: 'date', label: 'When', width: 15, kind: 'text' },
    { key: 'amount', label: 'Amount (USD)', width: 30, kind: 'text' },
    { key: 'notes', label: 'Notes', width: 30, kind: 'text' },
  ],
  entries: [{
    source: { url: 'https://etherscan.io/tx/0xabc', label: '0xabc…' },
    date: '2025-01-15',
    amount: '$1,200',
    notes: 'verified',
  }],
};

describe('renderChronologyBody (dynamic columns)', () => {
  it('renders a header cell per column', () => {
    const html = renderChronologyBody('t', baseData);
    expect(html).toContain('<th>Source</th>');
    expect(html).toContain('<th>When</th>');
    expect(html).toContain('<th>Amount (USD)</th>');
    expect(html).toContain('<th>Notes</th>');
  });

  it('reads custom column values from entry[column.key]', () => {
    const html = renderChronologyBody('t', baseData);
    expect(html).toContain('$1,200');
    expect(html).toContain('verified');
  });

  it('renders link column from entry.source.{url,label}', () => {
    const html = renderChronologyBody('t', baseData);
    expect(html).toMatch(/<a href="https:\/\/etherscan\.io\/tx\/0xabc">/);
    expect(html).toContain('0xabc…');
  });

  it('emits N/A when source is null', () => {
    const html = renderChronologyBody('t', {
      ...baseData,
      entries: [{ ...baseData.entries[0], source: null }],
    });
    expect(html).toContain('N/A');
  });

  it('falls back to DEFAULT_COLUMNS when data.columns is missing', () => {
    const html = renderChronologyBody('t', { entries: [] } as any);
    expect(html).toContain('<th>Source</th>');
    expect(html).toContain('<th>Date</th>');
    expect(html).toContain('<th>Description</th>');
    expect(html).toContain('<th>Details</th>');
  });

  it('renders legacy un-migrated entries (sourceUrl/sourceLabel flat) via boundary normalization', () => {
    const html = renderChronologyBody('t', {
      entries: [{ sourceUrl: 'https://x.example/tx', sourceLabel: '0xtest', date: '2025-01-01', description: 'd' }],
    } as any);
    expect(html).toMatch(/<a href="https:\/\/x\.example\/tx">/);
    expect(html).toContain('0xtest');
  });
});

describe('renderChronologyCsv', () => {
  it('expands link column to URL + Label pair; emits header in column order', () => {
    const csv = renderChronologyCsv(baseData);
    const header = csv.split('\r\n')[0].replace(/^﻿/, '');
    expect(header.split(',')).toEqual([
      'Source URL', 'Source Label', 'When', 'Amount (USD)', 'Notes', 'Highlight',
    ]);
  });

  it('emits BOM prefix for Excel', () => {
    expect(renderChronologyCsv(baseData).startsWith('﻿')).toBe(true);
  });

  it('exports legacy un-migrated entries via boundary normalization', () => {
    const csv = renderChronologyCsv({
      entries: [{ sourceUrl: 'https://x.example/tx', sourceLabel: '0xtest', date: '2025-01-01', description: 'd' }],
    } as any);
    expect(csv).toContain('https://x.example/tx');
    expect(csv).toContain('0xtest');
  });
});
