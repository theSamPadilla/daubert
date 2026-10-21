/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DeclarationExhibitsPanel } from './DeclarationExhibitsPanel';

jest.mock('@/components/Common/ConfirmProvider', () => ({ useConfirm: () => jest.fn() }));

const paragraph = (id: string, exhibitIds: string[] = []) => ({ id, text: id, subItems: [], exhibitIds, footnotes: [] });

const data = {
  schemaVersion: 1,
  caption: {},
  declarantName: 'Jordan Avery',
  sections: [
    { id: 's1', kind: 'qualifications', heading: 'EXPERT BACKGROUND', paragraphs: [paragraph('p1'), paragraph('p2')] },
    { id: 's2', kind: 'findings', heading: 'FINDINGS', paragraphs: [paragraph('p3', ['ex-a']), paragraph('p4', ['ex-a'])] },
  ],
  exhibits: [
    { id: 'ex-a', label: 'A', description: 'Trust account balance chart', source: { kind: 'other', note: 'chart' } },
    { id: 'ex-b', label: 'B', description: 'Bank statement export', source: { kind: 'file', note: 'WESTLAND-003118' } },
  ],
  execution: { place: '', date: '', signatureName: '' },
} as never;

describe('DeclarationExhibitsPanel', () => {
  it('shows each exhibit as a card with the paragraphs that cite it', () => {
    render(<DeclarationExhibitsPanel data={data} readOnly={false} onChange={jest.fn()} />);
    const [a, b] = screen.getAllByTestId('exhibit-card');

    expect(within(a).getByText('Trust account balance chart')).toBeTruthy();
    // Numbering is continuous across sections: findings paragraphs are 3 and 4.
    expect(within(a).getByText('Cited in ¶ 3, ¶ 4')).toBeTruthy();
    expect(within(b).getByText('Not cited')).toBeTruthy();
    expect(screen.getByText('1 not cited')).toBeTruthy();
  });

  it('opens the editor for one exhibit and emits edits', () => {
    const onChange = jest.fn();
    render(<DeclarationExhibitsPanel data={data} readOnly={false} onChange={onChange} />);

    expect(screen.queryByLabelText('Exhibit description')).toBeNull();
    fireEvent.click(screen.getByLabelText('Edit Exhibit B'));
    fireEvent.change(screen.getByLabelText('Exhibit description'), { target: { value: 'Statement export' } });

    const next = onChange.mock.calls[0][0];
    expect(next.exhibits[1].description).toBe('Statement export');
  });

  it('hides edit and delete controls when read-only', () => {
    render(<DeclarationExhibitsPanel data={data} readOnly onChange={jest.fn()} />);
    expect(screen.queryByLabelText('Edit Exhibit A')).toBeNull();
    expect(screen.queryByLabelText('Delete Exhibit A')).toBeNull();
  });
});
