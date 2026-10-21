/**
 * @jest-environment jsdom
 *
 * Drag-and-drop on the "Pull from CV" upload step: a dropped PDF is extracted
 * exactly like a chosen one, and a non-PDF is rejected without a request.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeclarantModal } from './DeclarantModal';

const mockExtractDeclarant = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'extractDeclarant'
          ? (...args: unknown[]) => mockExtractDeclarant(...args)
          : () => Promise.resolve([]),
    },
  ),
}));

function renderAtUploadStep() {
  render(
    <DeclarantModal
      declarant={null}
      orgSlug="acme"
      isAdmin={false}
      currentUserId="u1"
      onClose={() => {}}
      onSave={async () => null}
    />,
  );
  fireEvent.click(screen.getByText('Pull from CV'));
  return screen.getByTestId('declarant-extract-dropzone');
}

function dropFile(target: HTMLElement, file: File) {
  const dataTransfer = { files: [file], types: ['Files'], dropEffect: 'none' };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('DeclarantModal CV drop zone', () => {
  beforeEach(() => {
    mockExtractDeclarant.mockReset();
  });

  it('extracts a dropped PDF and moves to the review form', async () => {
    mockExtractDeclarant.mockResolvedValue({ displayName: 'Jordan Avery' });
    const zone = renderAtUploadStep();
    const file = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });

    dropFile(zone, file);

    await waitFor(() => expect(mockExtractDeclarant).toHaveBeenCalledWith('acme', file, 'cv'));
    await waitFor(() => expect(screen.getByDisplayValue('Jordan Avery')).toBeTruthy());
  });

  it('rejects a non-PDF drop without calling the extractor', () => {
    const zone = renderAtUploadStep();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    dropFile(zone, file);

    expect(mockExtractDeclarant).not.toHaveBeenCalled();
    expect(screen.getByText('Drop a PDF file.')).toBeTruthy();
  });
});
