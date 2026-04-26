import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  scope: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

const FILE_FIELDS = 'id, name, mimeType, size, modifiedTime, webViewLink';

/**
 * Provider-only wrapper around `googleapis`. Knows nothing about
 * `DataRoomConnection` — callers pass already-decrypted tokens. The owning
 * service is responsible for refresh, persistence, and broken-state handling.
 */
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly redirectUri: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    this.clientSecret = this.configService.get<string>(
      'GOOGLE_OAUTH_CLIENT_SECRET',
    );
    this.redirectUri = this.configService.get<string>(
      'GOOGLE_OAUTH_REDIRECT_URI',
    );
  }

  /** Build a fresh OAuth2 client per request. Cheap, and avoids cross-request state. */
  private newOAuthClient(): OAuth2Client {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error(
        'Google OAuth env vars are not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI.',
      );
    }
    return new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri,
    );
  }

  /** OAuth2 client pre-loaded with an access token, ready for Drive calls. */
  private clientWithAccessToken(accessToken: string): OAuth2Client {
    const c = this.newOAuthClient();
    c.setCredentials({ access_token: accessToken });
    return c;
  }

  private drive(accessToken: string): drive_v3.Drive {
    return google.drive({ version: 'v3', auth: this.clientWithAccessToken(accessToken) });
  }

  /**
   * Build the consent URL. `prompt: 'consent'` forces a refresh-token return
   * even on re-consent — without it, Google returns no refresh token if the
   * user has previously granted the scope.
   */
  getAuthUrl(state: string): string {
    const client = this.newOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DRIVE_SCOPE],
      state,
      include_granted_scopes: true,
    });
  }

  async exchangeCode(code: string): Promise<TokenSet> {
    const client = this.newOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) {
      throw new Error('Google did not return an access token.');
    }
    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Ensure prompt=consent and access_type=offline.',
      );
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600 * 1000),
      scope: tokens.scope ?? DRIVE_SCOPE,
    };
  }

  /**
   * Refresh an access token. If Google rotates refresh tokens, the new one is
   * returned; otherwise we echo the input value back so callers always have a
   * token to persist.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiry: Date }> {
    const client = this.newOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new Error('Refresh did not return an access token.');
    }
    return {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token ?? refreshToken,
      expiry: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600 * 1000),
    };
  }

  /** Best-effort revoke. Logs and swallows errors so the caller can still
   * delete its local row. */
  async revokeToken(refreshToken: string): Promise<void> {
    try {
      const res = await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Google token revoke returned ${res.status}: ${body.slice(0, 200)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Google token revoke failed: ${(err as Error).message}`,
      );
    }
  }

  async getFolder(
    accessToken: string,
    folderId: string,
  ): Promise<{ id: string; name: string; mimeType: string }> {
    const drive = this.drive(accessToken);
    const { data } = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    if (!data.id || !data.name || !data.mimeType) {
      throw new Error('Drive returned incomplete folder metadata.');
    }
    return { id: data.id, name: data.name, mimeType: data.mimeType };
  }

  async listFiles(
    accessToken: string,
    folderId: string,
  ): Promise<DriveFile[]> {
    const drive = this.drive(accessToken);
    const { data } = await drive.files.list({
      q: `'${escapeDriveQueryString(folderId)}' in parents and trashed=false`,
      fields: `files(${FILE_FIELDS})`,
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return (data.files ?? []).map((f) => this.toDriveFile(f));
  }

  async getFileMetadata(
    accessToken: string,
    fileId: string,
  ): Promise<{ name: string; mimeType: string; size: string }> {
    const drive = this.drive(accessToken);
    const { data } = await drive.files.get({
      fileId,
      fields: 'name, mimeType, size',
      supportsAllDrives: true,
    });
    if (!data.name || !data.mimeType) {
      throw new Error('Drive returned incomplete file metadata.');
    }
    // `size` is absent for native Google docs (Docs/Sheets/Slides). Caller
    // can decide how to handle a missing Content-Length.
    return {
      name: data.name,
      mimeType: data.mimeType,
      size: data.size ?? '',
    };
  }

  async downloadFile(
    accessToken: string,
    fileId: string,
  ): Promise<Readable> {
    const drive = this.drive(accessToken);
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    return res.data as Readable;
  }

  async uploadFile(
    accessToken: string,
    folderId: string,
    name: string,
    mimeType: string,
    body: Readable,
  ): Promise<DriveFile> {
    const drive = this.drive(accessToken);
    const { data } = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return this.toDriveFile(data);
  }

  private toDriveFile(f: drive_v3.Schema$File): DriveFile {
    if (!f.id || !f.name || !f.mimeType) {
      throw new Error('Drive returned a file with missing required fields.');
    }
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ?? undefined,
      modifiedTime: f.modifiedTime ?? undefined,
      webViewLink: f.webViewLink ?? undefined,
    };
  }
}

/**
 * Escape a value that will be embedded in a Drive `q` query string between
 * single quotes. Drive's query syntax only requires escaping `\` and `'`.
 * Today the DTO regex `^[a-zA-Z0-9_-]{20,}$` makes this defensive — a future
 * loosening of validation shouldn't open an injection vector.
 * https://developers.google.com/drive/api/guides/ref-search-terms
 */
function escapeDriveQueryString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
