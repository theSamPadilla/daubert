/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { DataRoomFile } from '@/lib/api-client';

// --- Mock next/navigation ------------------------------------------------
jest.mock('next/navigation', () => ({
  useParams: () => ({ caseId: 'case-123' }),
}));

// --- Mock CaseContext -------------------------------------------------------
// We re-mock per test via the mockViewerRole variable below.
let mockViewerRole: string | null = 'owner';

jest.mock('@/contexts/CaseContext', () => ({
  useCaseContext: () => ({ viewerRole: mockViewerRole }),
}));

// --- Mock api-client -------------------------------------------------------
const mockDataRoomListFiles = jest.fn<Promise<DataRoomFile[]>, [string]>();
const mockDataRoomDeleteFile = jest.fn<Promise<void>, [string, string]>();
const mockDataRoomDownload = jest.fn<Promise<void>, [string, string, string]>();
const mockDataRoomUpload = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    dataRoomListFiles: (...args: [string]) => mockDataRoomListFiles(...args),
    dataRoomDeleteFile: (...args: [string, string]) => mockDataRoomDeleteFile(...args),
    dataRoomDownload: (...args: [string, string, string]) => mockDataRoomDownload(...args),
    dataRoomUpload: (...args: unknown[]) => mockDataRoomUpload(...args),
  },
}));

// --- Mock PageHeader / UserMenu / Loader (minimal stubs) ------------------
jest.mock('@/components/Common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}));
jest.mock('@/components/Auth/UserMenu', () => ({
  __esModule: true,
  default: () => <div data-testid="user-menu" />,
}));
jest.mock('@/components/Common/Loader', () => ({
  Loader: () => <div data-testid="loader" />,
}));

// --- Fake files ------------------------------------------------------------
const FAKE_FILES: DataRoomFile[] = [
  {
    id: 'file-1',
    name: 'contract.pdf',
    mimeType: 'application/pdf',
    size: '204800',
    uploadedByUserId: 'user-abc',
    createdAt: '2024-01-15T12:00:00Z',
  },
  {
    id: 'file-2',
    name: 'evidence.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: '51200',
    uploadedByUserId: 'user-abc',
    createdAt: '2024-01-16T09:30:00Z',
  },
];

// Import the page AFTER all mocks are set up
import DataRoomPage from './page';

// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockViewerRole = 'owner';
  mockDataRoomListFiles.mockResolvedValue(FAKE_FILES);
  mockDataRoomDeleteFile.mockResolvedValue(undefined);
  mockDataRoomDownload.mockResolvedValue(undefined);
  // Suppress confirm() in jsdom
  global.confirm = jest.fn().mockReturnValue(true);
});

describe('DataRoomPage', () => {
  // (a) Both file names render after load
  it('renders both file names after load', async () => {
    render(<DataRoomPage />);
    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeTruthy();
      expect(screen.getByText('evidence.xlsx')).toBeTruthy();
    });
  });

  // (b) For an owner/editor, delete control exists and clicking calls dataRoomDeleteFile
  it('shows delete controls for owner and calls dataRoomDeleteFile with correct fileId', async () => {
    mockViewerRole = 'owner';
    render(<DataRoomPage />);

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    const deleteButtons = screen.getAllByTitle('Delete');
    expect(deleteButtons.length).toBe(2);

    // Click the delete button for the first file (file-1)
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockDataRoomDeleteFile).toHaveBeenCalledWith('case-123', 'file-1');
    });
  });

  it('shows upload control for editor', async () => {
    mockViewerRole = 'editor';
    render(<DataRoomPage />);

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    expect(screen.getByText('Upload file')).toBeTruthy();
  });

  // (c) For a viewer, no upload/delete controls but download is available
  it('shows no upload/delete controls for viewer but download is available', async () => {
    mockViewerRole = 'viewer';
    render(<DataRoomPage />);

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    expect(screen.queryByText('Upload file')).toBeNull();
    expect(screen.queryByTitle('Delete')).toBeNull();

    const downloadButtons = screen.getAllByTitle('Download');
    expect(downloadButtons.length).toBe(2);
  });

  // Empty state
  it('shows empty state when no files', async () => {
    mockDataRoomListFiles.mockResolvedValue([]);
    render(<DataRoomPage />);

    await waitFor(() => {
      expect(screen.getByText(/No files yet/)).toBeTruthy();
    });
  });

  // Empty state with upload hint for mutators
  it('shows upload hint in empty state for owner', async () => {
    mockDataRoomListFiles.mockResolvedValue([]);
    mockViewerRole = 'owner';
    render(<DataRoomPage />);

    await waitFor(() => {
      expect(screen.getByText(/Upload one to get started/)).toBeTruthy();
    });
  });
});
