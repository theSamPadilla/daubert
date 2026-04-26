import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Mock `googleapis` BEFORE importing the service under test. Each mocked OAuth2
// instance and drive() call shares the same jest.fn() refs (held in module
// scope below) so tests can assert on the calls + drive return values per
// test case.
// ---------------------------------------------------------------------------
const mockGenerateAuthUrl = jest.fn();
const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockRefreshAccessToken = jest.fn();

const mockFilesGet = jest.fn();
const mockFilesList = jest.fn();
const mockFilesCreate = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        getToken: mockGetToken,
        setCredentials: mockSetCredentials,
        refreshAccessToken: mockRefreshAccessToken,
      })),
    },
    drive: jest.fn().mockReturnValue({
      files: {
        get: mockFilesGet,
        list: mockFilesList,
        create: mockFilesCreate,
      },
    }),
  },
}));

// Import under test AFTER the jest.mock above.
import { GoogleDriveService } from './google-drive.service';

function makeService(): GoogleDriveService {
  const config = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'GOOGLE_OAUTH_CLIENT_ID':
          return 'client-id';
        case 'GOOGLE_OAUTH_CLIENT_SECRET':
          return 'client-secret';
        case 'GOOGLE_OAUTH_REDIRECT_URI':
          return 'http://localhost/callback';
        default:
          return undefined;
      }
    }),
  } as unknown as ConfigService;

  return new GoogleDriveService(config);
}

describe('GoogleDriveService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // listFiles
  // -------------------------------------------------------------------------
  describe('listFiles', () => {
    it('passes the correct `q` filter and `fields` selector to drive.files.list', async () => {
      mockFilesList.mockResolvedValue({
        data: {
          files: [
            {
              id: 'f1',
              name: 'doc.pdf',
              mimeType: 'application/pdf',
              size: '123',
            },
          ],
        },
      });

      const svc = makeService();
      const result = await svc.listFiles('access-token', 'folder-xyz');

      expect(mockFilesList).toHaveBeenCalledTimes(1);
      const args = mockFilesList.mock.calls[0][0];
      expect(args.q).toBe(`'folder-xyz' in parents and trashed=false`);
      expect(args.fields).toMatch(/^files\(/);
      expect(args.fields).toContain('id');
      expect(args.fields).toContain('name');
      expect(args.fields).toContain('mimeType');
      expect(args.supportsAllDrives).toBe(true);
      expect(args.includeItemsFromAllDrives).toBe(true);

      expect(result).toEqual([
        {
          id: 'f1',
          name: 'doc.pdf',
          mimeType: 'application/pdf',
          size: '123',
          modifiedTime: undefined,
          webViewLink: undefined,
        },
      ]);
    });

    it('returns an empty array when Drive returns no files', async () => {
      mockFilesList.mockResolvedValue({ data: {} });
      const svc = makeService();
      expect(await svc.listFiles('t', 'folder-1')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // uploadFile
  // -------------------------------------------------------------------------
  describe('uploadFile', () => {
    it('passes the Readable stream straight to media.body (no buffering)', async () => {
      mockFilesCreate.mockResolvedValue({
        data: {
          id: 'new-id',
          name: 'hello.txt',
          mimeType: 'text/plain',
          size: '5',
        },
      });

      const stream = Readable.from(['hello']);
      const svc = makeService();
      const result = await svc.uploadFile(
        'access-token',
        'folder-1',
        'hello.txt',
        'text/plain',
        stream,
      );

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const args = mockFilesCreate.mock.calls[0][0];
      expect(args.requestBody).toEqual({
        name: 'hello.txt',
        parents: ['folder-1'],
      });
      expect(args.media.mimeType).toBe('text/plain');
      // Critical: the body is the same Readable, not a Buffer/string.
      expect(args.media.body).toBe(stream);
      expect(args.media.body).toBeInstanceOf(Readable);
      expect(Buffer.isBuffer(args.media.body)).toBe(false);
      expect(typeof args.media.body).not.toBe('string');

      expect(result).toEqual({
        id: 'new-id',
        name: 'hello.txt',
        mimeType: 'text/plain',
        size: '5',
        modifiedTime: undefined,
        webViewLink: undefined,
      });
    });
  });

  // -------------------------------------------------------------------------
  // refreshAccessToken
  // -------------------------------------------------------------------------
  describe('refreshAccessToken', () => {
    it('maps Google credentials into { accessToken, refreshToken, expiry }', async () => {
      const expiryMs = Date.now() + 3600 * 1000;
      mockRefreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expiry_date: expiryMs,
        },
      });

      const svc = makeService();
      const out = await svc.refreshAccessToken('old-refresh');

      expect(mockSetCredentials).toHaveBeenCalledWith({
        refresh_token: 'old-refresh',
      });
      expect(mockRefreshAccessToken).toHaveBeenCalled();
      expect(out.accessToken).toBe('new-access');
      expect(out.refreshToken).toBe('new-refresh');
      expect(out.expiry).toBeInstanceOf(Date);
      expect(out.expiry.getTime()).toBe(expiryMs);
    });

    it('echoes the input refresh token when Google does not rotate it', async () => {
      mockRefreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-access',
          // refresh_token absent
          expiry_date: Date.now() + 3600 * 1000,
        },
      });

      const svc = makeService();
      const out = await svc.refreshAccessToken('original-refresh');
      expect(out.refreshToken).toBe('original-refresh');
    });

    it('throws when Google returns no access token', async () => {
      mockRefreshAccessToken.mockResolvedValue({ credentials: {} });
      const svc = makeService();
      await expect(svc.refreshAccessToken('r')).rejects.toThrow(
        /Refresh did not return an access token/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // revokeToken — best effort, never throws
  // -------------------------------------------------------------------------
  describe('revokeToken', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('resolves without throwing when fetch rejects', async () => {
      // Suppress the warn log noise for cleaner test output.
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

      const svc = makeService();
      await expect(svc.revokeToken('refresh-token')).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });

    it('resolves without throwing when Google returns a non-OK status', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_token',
      }) as unknown as typeof fetch;

      const svc = makeService();
      await expect(svc.revokeToken('refresh-token')).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });

    it('posts to the revoke endpoint with the token in the body on the happy path', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '',
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const svc = makeService();
      await svc.revokeToken('the-refresh-token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/revoke');
      expect(init.method).toBe('POST');
      expect(String(init.body)).toContain('token=the-refresh-token');
    });
  });
});
