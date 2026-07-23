/**
 * @jest-environment jsdom
 *
 * Tests for the OrgCasesAdminSection on the org Cases tab.
 *
 * What we care about:
 * - Lists cases filtered to the org by orgId.
 * - Delete button opens a confirm modal.
 * - The confirm button stays disabled until the case name is typed exactly.
 * - Confirming calls deleteCase and reloads the list.
 * - Cancel closes the modal without deleting.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockListCases = jest.fn();
const mockDeleteCase = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listCases: (...args: unknown[]) => mockListCases(...args),
    deleteCase: (...args: unknown[]) => mockDeleteCase(...args),
  },
}));

import { OrgCasesAdminSection } from './OrgCasesAdminSection';

const NOW = '2026-06-10T10:00:00.000Z';

const CASE_IN_ORG = {
  id: 'case-1',
  name: 'Geffen',
  summary: 'Le Nez Purchase Dispute',
  orgId: 'org-1',
  createdAt: NOW,
  updatedAt: NOW,
};

const CASE_OTHER_ORG = {
  id: 'case-2',
  name: 'Other Org Case',
  summary: null,
  orgId: 'org-2',
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('lists only cases belonging to this org', async () => {
  mockListCases.mockResolvedValue([CASE_IN_ORG, CASE_OTHER_ORG]);
  render(<OrgCasesAdminSection orgId="org-1" />);

  expect(await screen.findByText('Geffen')).not.toBeNull();
  expect(screen.queryByText('Other Org Case')).toBeNull();
});

it('shows an empty state when no cases belong to the org', async () => {
  mockListCases.mockResolvedValue([CASE_OTHER_ORG]);
  render(<OrgCasesAdminSection orgId="org-1" />);

  expect(await screen.findByText(/no cases in this organization/i)).not.toBeNull();
});

it('opens the delete modal when the trash button is clicked', async () => {
  mockListCases.mockResolvedValue([CASE_IN_ORG]);
  render(<OrgCasesAdminSection orgId="org-1" />);

  fireEvent.click(await screen.findByRole('button', { name: /delete case geffen/i }));

  expect(await screen.findByRole('dialog')).not.toBeNull();
  expect(screen.getByText(/this action cannot be undone/i)).not.toBeNull();
});

it('keeps the Delete button disabled until the case name is typed exactly', async () => {
  mockListCases.mockResolvedValue([CASE_IN_ORG]);
  render(<OrgCasesAdminSection orgId="org-1" />);

  fireEvent.click(await screen.findByRole('button', { name: /delete case geffen/i }));

  const input = await screen.findByLabelText(/type .* to confirm/i);
  const deleteBtn = screen.getByRole('button', { name: /^delete case$/i });
  expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(input, { target: { value: 'Geffenn' } });
  expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(input, { target: { value: 'Geffen' } });
  expect((deleteBtn as HTMLButtonElement).disabled).toBe(false);
});

it('calls deleteCase and reloads the list on confirm', async () => {
  mockListCases.mockResolvedValue([CASE_IN_ORG]);
  mockDeleteCase.mockResolvedValue(undefined);
  render(<OrgCasesAdminSection orgId="org-1" />);

  fireEvent.click(await screen.findByRole('button', { name: /delete case geffen/i }));
  const input = await screen.findByLabelText(/type .* to confirm/i);
  fireEvent.change(input, { target: { value: 'Geffen' } });
  fireEvent.click(screen.getByRole('button', { name: /^delete case$/i }));

  await waitFor(() => expect(mockDeleteCase).toHaveBeenCalledWith('case-1'));
  // Reload: listCases called once on mount + once after delete.
  await waitFor(() => expect(mockListCases).toHaveBeenCalledTimes(2));
});

it('cancel closes the modal without deleting', async () => {
  mockListCases.mockResolvedValue([CASE_IN_ORG]);
  render(<OrgCasesAdminSection orgId="org-1" />);

  fireEvent.click(await screen.findByRole('button', { name: /delete case geffen/i }));
  fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mockDeleteCase).not.toHaveBeenCalled();
});
