/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { components } from '@/generated/api-types';

type Page = components['schemas']['CaseActivityPage'];
type Entry = components['schemas']['CaseActivityEntry'];

jest.mock('next/navigation', () => ({ useParams: () => ({ caseId: 'case-123' }) }));
const mockList = jest.fn<Promise<Page>, [string, (string | null)?, number?]>();
jest.mock('@/lib/api-client', () => ({
  apiClient: { listCaseActivity: (...args: [string, (string | null)?, number?]) => mockList(...args) },
}));
jest.mock('@/components/Common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}));
jest.mock('@/components/Auth/UserMenu', () => ({ __esModule: true, default: () => <div data-testid="user-menu" /> }));
jest.mock('@/components/Common/Loader', () => ({ Loader: () => <div data-testid="loader" /> }));

import ActivityPage from './page';

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1', createdAt: '2026-10-09T12:00:00.000Z', source: 'chat', agent: 'claude-opus-5',
    action: 'web_search', input: { query: 'mixer flows' }, status: 'ok',
    summary: { sources: [{ title: 'T', url: 'https://u' }] }, backfilled: false, conversationId: 'c1',
    user: { id: 'u1', name: 'Ana Ruiz', email: 'ana@firm.com' },
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

it('lists entries with action, key input, who and source', async () => {
  mockList.mockResolvedValue({ items: [entry(), entry({ id: 'e2', source: 'mcp', agent: 'Claude Desktop', action: 'get_case_data', input: {}, status: 'error', summary: { error: 'Forbidden' } })], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('Web search')).toBeTruthy());
  expect(screen.getByText('mixer flows')).toBeTruthy();
  expect(screen.getAllByText('Ana Ruiz').length).toBe(2);
  expect(screen.getByText('Daubert chat')).toBeTruthy();
  expect(screen.getByText('Claude Desktop')).toBeTruthy();
  expect(screen.getByText('Failed')).toBeTruthy();
  expect(mockList).toHaveBeenCalledWith('case-123', null, 50);
});

it('expands a row to show its input and summary', async () => {
  mockList.mockResolvedValue({ items: [entry()], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('Web search')).toBeTruthy());
  fireEvent.click(screen.getByText('Web search'));
  expect(screen.getByText(/"query": "mixer flows"/)).toBeTruthy();
  expect(screen.getByText(/https:\/\/u/)).toBeTruthy();
});

it('loads the next page', async () => {
  mockList
    .mockResolvedValueOnce({ items: [entry()], nextCursor: 'cur-1' })
    .mockResolvedValueOnce({ items: [entry({ id: 'e9', action: 'execute_script', input: { name: 'hops' } })], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('Load more')).toBeTruthy());
  fireEvent.click(screen.getByText('Load more'));
  await waitFor(() => expect(screen.getByText('Ran script')).toBeTruthy());
  expect(mockList).toHaveBeenLastCalledWith('case-123', 'cur-1', 50);
  expect(screen.queryByText('Load more')).toBeNull();
});

it('shows an empty state', async () => {
  mockList.mockResolvedValue({ items: [], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('No agent activity on this case yet.')).toBeTruthy());
});
