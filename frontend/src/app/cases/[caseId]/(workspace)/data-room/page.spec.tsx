/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { DataRoomContents, DataRoomFile, DataRoomFolder } from '@/lib/api-client';

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
const mockDataRoomContents = jest.fn<Promise<DataRoomContents>, [string, (string | null)?]>();
const mockDataRoomDeleteFile = jest.fn<Promise<void>, [string, string]>();
const mockDataRoomDownload = jest.fn<Promise<void>, [string, string, string]>();
const mockDataRoomUpload = jest.fn();
const mockDataRoomImportFromDrive = jest.fn();
const mockDataRoomCreateFolder = jest.fn();
const mockDataRoomDeleteFolder = jest.fn();
const mockDataRoomMoveFile = jest.fn();
const mockDataRoomMoveFolder = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    dataRoomContents: (...args: [string, (string | null)?]) => mockDataRoomContents(...args),
    dataRoomDeleteFile: (...args: [string, string]) => mockDataRoomDeleteFile(...args),
    dataRoomDownload: (...args: [string, string, string]) => mockDataRoomDownload(...args),
    dataRoomUpload: (...args: unknown[]) => mockDataRoomUpload(...args),
    dataRoomImportFromDrive: (...args: unknown[]) => mockDataRoomImportFromDrive(...args),
    dataRoomCreateFolder: (...args: unknown[]) => mockDataRoomCreateFolder(...args),
    dataRoomDeleteFolder: (...args: unknown[]) => mockDataRoomDeleteFolder(...args),
    dataRoomMoveFile: (...args: unknown[]) => mockDataRoomMoveFile(...args),
    dataRoomMoveFolder: (...args: unknown[]) => mockDataRoomMoveFolder(...args),
  },
}));

// --- Mock google-picker ----------------------------------------------------
const mockPickDriveFiles = jest.fn();
jest.mock('@/lib/google-picker', () => ({
  pickDriveFiles: (...args: unknown[]) => mockPickDriveFiles(...args),
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

const FAKE_FOLDER: DataRoomFolder = {
  id: 'folder-1',
  caseId: 'case-123',
  parentFolderId: null,
  name: 'Discovery',
  createdByUserId: 'user-abc',
  createdAt: '2024-01-10T08:00:00Z',
};

const contents = (over: Partial<DataRoomContents> = {}): DataRoomContents => ({
  breadcrumb: [],
  folders: [],
  files: FAKE_FILES,
  ...over,
});

// Import the page AFTER all mocks are set up
import DataRoomPage from './page';
import { ConfirmProvider } from '@/components/Common/ConfirmProvider';

// Render the page inside the real ConfirmProvider so useConfirm() resolves.
const renderPage = () =>
  render(
    <ConfirmProvider>
      <DataRoomPage />
    </ConfirmProvider>,
  );

// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockViewerRole = 'owner';
  mockDataRoomContents.mockResolvedValue(contents());
  mockDataRoomDeleteFile.mockResolvedValue(undefined);
  mockDataRoomDownload.mockResolvedValue(undefined);
  mockPickDriveFiles.mockResolvedValue({ accessToken: 't', fileIds: ['a', 'b'] });
  mockDataRoomImportFromDrive.mockResolvedValue({ imported: FAKE_FILES, failed: [] });
  mockDataRoomCreateFolder.mockResolvedValue(FAKE_FOLDER);
  mockDataRoomDeleteFolder.mockResolvedValue(undefined);
  mockDataRoomMoveFile.mockResolvedValue(undefined);
  mockDataRoomMoveFolder.mockResolvedValue(undefined);
});

describe('DataRoomPage', () => {
  // (a) Both file names render after load
  it('renders both file names after load', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeTruthy();
      expect(screen.getByText('evidence.xlsx')).toBeTruthy();
    });
  });

  // (b) For an owner/editor, delete control exists and clicking calls dataRoomDeleteFile
  it('shows delete controls for owner and calls dataRoomDeleteFile with correct fileId', async () => {
    mockViewerRole = 'owner';
    renderPage();

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    const deleteButtons = screen.getAllByTitle('Delete');
    expect(deleteButtons.length).toBe(2);

    // Click the delete button for the first file (file-1)
    fireEvent.click(deleteButtons[0]);

    // Confirm in the reusable modal (icon buttons carry no text, so the
    // "Delete" text node uniquely identifies the modal's confirm button).
    await waitFor(() => expect(screen.getByText('Delete file?')).toBeTruthy());
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDataRoomDeleteFile).toHaveBeenCalledWith('case-123', 'file-1');
    });
  });

  it('shows upload control for editor', async () => {
    mockViewerRole = 'editor';
    renderPage();

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    expect(screen.getByText('Upload file')).toBeTruthy();
  });

  // (c) For a viewer, no upload/delete controls but download is available
  it('shows no upload/delete controls for viewer but download is available', async () => {
    mockViewerRole = 'viewer';
    renderPage();

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    expect(screen.queryByText('Upload file')).toBeNull();
    expect(screen.queryByTitle('Delete')).toBeNull();

    const downloadButtons = screen.getAllByTitle('Download');
    expect(downloadButtons.length).toBe(2);
  });

  // Empty state
  it('shows empty state when no files', async () => {
    mockDataRoomContents.mockResolvedValue(contents({ files: [], folders: [] }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/No files yet/)).toBeTruthy();
    });
  });

  // Empty state with upload hint for mutators
  it('shows upload hint in empty state for owner', async () => {
    mockDataRoomContents.mockResolvedValue(contents({ files: [], folders: [] }));
    mockViewerRole = 'owner';
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Upload one to get started/)).toBeTruthy();
    });
  });

  // Google Drive import — editor sees button, clicks it, calls import + refreshes list
  it('calls dataRoomImportFromDrive and re-fetches list when editor clicks "Add from Google Drive"', async () => {
    mockViewerRole = 'editor';
    renderPage();

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    const driveButton = screen.getByText('Add from Google Drive');
    expect(driveButton).toBeTruthy();

    fireEvent.click(driveButton);

    await waitFor(() => {
      expect(mockDataRoomImportFromDrive).toHaveBeenCalledWith('case-123', 't', ['a', 'b'], null);
    });

    // dataRoomContents should have been called again after the import
    await waitFor(() => {
      expect(mockDataRoomContents.mock.calls.length).toBeGreaterThan(1);
    });
  });

  // Google Drive import button is NOT visible for viewers
  it('does not show "Add from Google Drive" button for viewer', async () => {
    mockViewerRole = 'viewer';
    renderPage();

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    expect(screen.queryByText('Add from Google Drive')).toBeNull();
  });

  // Folders render and clicking a folder navigates into it
  it('renders a folder and navigates into it on click', async () => {
    mockDataRoomContents.mockResolvedValue(contents({ folders: [FAKE_FOLDER] }));
    renderPage();

    await waitFor(() => expect(screen.getByText('Discovery')).toBeTruthy());

    fireEvent.click(screen.getByText('Discovery'));

    await waitFor(() => {
      expect(mockDataRoomContents).toHaveBeenCalledWith('case-123', 'folder-1');
    });
  });

  // New folder — prompt for name, create folder, refetch
  it('creates a folder via "New folder" button', async () => {
    mockViewerRole = 'owner';
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('Exhibits');
    renderPage();

    await waitFor(() => expect(screen.getByText('contract.pdf')).toBeTruthy());

    fireEvent.click(screen.getByText('New folder'));

    await waitFor(() => {
      expect(mockDataRoomCreateFolder).toHaveBeenCalledWith('case-123', 'Exhibits', null);
    });

    promptSpy.mockRestore();
  });
});
