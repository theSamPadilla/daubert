import { Readable } from 'stream';

const filesGet = jest.fn();
const filesExport = jest.fn();
const setCredentials = jest.fn();
const OAuth2 = jest.fn().mockImplementation(() => ({ setCredentials }));
const drive = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2 },
    drive,
  },
}));

// Imported after the mock is registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GoogleDriveImportService } = require('./google-drive-import.service');

describe('GoogleDriveImportService', () => {
  let service: InstanceType<typeof GoogleDriveImportService>;

  beforeEach(() => {
    jest.clearAllMocks();
    drive.mockReturnValue({
      files: { get: filesGet, export: filesExport },
    });
    service = new GoogleDriveImportService();
  });

  it('binary file: returns name+mime unchanged and fetches via files.get alt=media stream', async () => {
    filesGet
      .mockResolvedValueOnce({
        data: { name: 'report.pdf', mimeType: 'application/pdf' },
      })
      .mockResolvedValueOnce({ data: Readable.from(Buffer.from('pdf-bytes')) });

    const result = await service.fetchForImport('tok', 'file-1');

    expect(result.name).toBe('report.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.stream).toBeInstanceOf(Readable);
    expect(setCredentials).toHaveBeenCalledWith({ access_token: 'tok' });
    // metadata fetch
    expect(filesGet).toHaveBeenNthCalledWith(1, {
      fileId: 'file-1',
      fields: 'name, mimeType',
      supportsAllDrives: true,
    });
    // media download
    expect(filesGet).toHaveBeenNthCalledWith(
      2,
      { fileId: 'file-1', alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    expect(filesExport).not.toHaveBeenCalled();
  });

  it('google doc: returns <name>.docx + docx export mime via files.export', async () => {
    filesGet.mockResolvedValueOnce({
      data: {
        name: 'My Doc',
        mimeType: 'application/vnd.google-apps.document',
      },
    });
    filesExport.mockResolvedValueOnce({
      data: Readable.from(Buffer.from('docx-bytes')),
    });

    const result = await service.fetchForImport('tok', 'file-2');

    expect(result.name).toBe('My Doc.docx');
    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.stream).toBeInstanceOf(Readable);
    expect(filesExport).toHaveBeenCalledWith(
      {
        fileId: 'file-2',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      { responseType: 'stream' },
    );
  });

  it('google form (no export mapping): throws Unsupported', async () => {
    filesGet.mockResolvedValueOnce({
      data: {
        name: 'Survey',
        mimeType: 'application/vnd.google-apps.form',
      },
    });

    await expect(service.fetchForImport('tok', 'file-3')).rejects.toThrow(
      /Unsupported/,
    );
    expect(filesExport).not.toHaveBeenCalled();
  });

  it('missing name throws incomplete metadata', async () => {
    filesGet.mockResolvedValueOnce({
      data: { mimeType: 'application/pdf' },
    });

    await expect(service.fetchForImport('tok', 'file-4')).rejects.toThrow(
      /incomplete metadata/,
    );
  });

  it('missing mimeType throws incomplete metadata', async () => {
    filesGet.mockResolvedValueOnce({
      data: { name: 'orphan' },
    });

    await expect(service.fetchForImport('tok', 'file-5')).rejects.toThrow(
      /incomplete metadata/,
    );
  });
});
