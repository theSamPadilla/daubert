import { Readable } from 'stream';

const filesCreate = jest.fn();
const setCredentials = jest.fn();
const OAuth2 = jest.fn().mockImplementation(() => ({ setCredentials }));
const drive = jest.fn();

jest.mock('googleapis', () => ({
  google: { auth: { OAuth2 }, drive },
}));

const { GoogleDriveExportService } = require('./google-drive-export.service');

describe('GoogleDriveExportService', () => {
  let service: any;
  beforeEach(() => {
    jest.clearAllMocks();
    drive.mockReturnValue({ files: { create: filesCreate } });
    service = new GoogleDriveExportService();
  });

  it('creates a Drive file from a stream in the destination folder', async () => {
    filesCreate.mockResolvedValue({ data: { id: 'drive123', webViewLink: 'https://drive/view' } });
    const res = await service.uploadToFolder('tok', 'doc.pdf', 'application/pdf', Readable.from(['x']), 'folderABC');
    expect(setCredentials).toHaveBeenCalledWith({ access_token: 'tok' });
    expect(filesCreate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({ name: 'doc.pdf', parents: ['folderABC'] }),
      media: expect.objectContaining({ mimeType: 'application/pdf' }),
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    }));
    expect(res).toEqual({ id: 'drive123', webViewLink: 'https://drive/view' });
  });

  it('omits parents when destinationFolderId is null (My Drive root)', async () => {
    filesCreate.mockResolvedValue({ data: { id: 'd2', webViewLink: null } });
    await service.uploadToFolder('tok', 'a.csv', 'text/csv', Readable.from(['y']), null);
    const arg = filesCreate.mock.calls[0][0];
    expect(arg.requestBody.parents).toBeUndefined();
  });
});
