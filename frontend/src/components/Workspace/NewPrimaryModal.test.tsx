/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NewPrimaryModal } from './NewPrimaryModal';

const mockCreateProduction = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listDeclarationFormats: () => Promise.resolve([]),
    dataRoomListFiles: () => Promise.resolve([]),
    createProduction: (...args: unknown[]) => mockCreateProduction(...args),
  },
}));

jest.mock('@/contexts/CaseContext', () => ({
  useCaseContext: () => ({
    caseId: 'case-1',
    newPrimaryDefault: 'production',
    closeNewPrimary: jest.fn(),
    setProductions: jest.fn(),
    reloadInvestigations: jest.fn(),
  }),
}));

// Lets the declaration-formats fetch on mount settle inside act().
async function renderModal() {
  render(<NewPrimaryModal />);
  await act(async () => {});
}

describe('NewPrimaryModal production type picker', () => {
  it('lists every production type as a radio option, with report selected', async () => {
    await renderModal();
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /Report/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('selects a type, updates the placeholder, and creates that type', async () => {
    mockCreateProduction.mockResolvedValue({ id: 'prod-1' });
    await renderModal();

    fireEvent.click(screen.getByRole('radio', { name: /Chart/ }));
    expect(screen.getByRole('radio', { name: /Chart/ }).getAttribute('aria-checked')).toBe('true');

    const nameInput = screen.getByPlaceholderText('e.g. Trust Account Balance');
    fireEvent.change(nameInput, { target: { value: 'Balance' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(mockCreateProduction).toHaveBeenCalledWith(
        'case-1',
        expect.objectContaining({ name: 'Balance', type: 'chart' }),
      ),
    );
  });
});
