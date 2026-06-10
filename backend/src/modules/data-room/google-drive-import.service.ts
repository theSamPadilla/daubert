import { Injectable } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';

// Native Google MIME -> { exportMime, ext } (editable Office formats)
const EXPORT_MAP: Record<string, { exportMime: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    exportMime:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    exportMime:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    exportMime:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
};

@Injectable()
export class GoogleDriveImportService {
  private drive(accessToken: string): drive_v3.Drive {
    const auth = new google.auth.OAuth2(); // bare client; an access token needs no client id/secret
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  }

  // Returns the importable form of a Drive file: final name, final mimeType, and a Readable.
  async fetchForImport(
    accessToken: string,
    fileId: string,
  ): Promise<{ name: string; mimeType: string; stream: Readable }> {
    const drive = this.drive(accessToken);
    const { data } = await drive.files.get({
      fileId,
      fields: 'name, mimeType',
      supportsAllDrives: true,
    });
    if (!data.name || !data.mimeType) {
      throw new Error('Drive returned incomplete metadata');
    }

    const exp = EXPORT_MAP[data.mimeType];
    if (exp) {
      const res = await drive.files.export(
        { fileId, mimeType: exp.exportMime },
        { responseType: 'stream' },
      );
      return {
        name: `${data.name}.${exp.ext}`,
        mimeType: exp.exportMime,
        stream: res.data as Readable,
      };
    }
    if (data.mimeType.startsWith('application/vnd.google-apps.')) {
      throw new Error(`Unsupported Google file type: ${data.mimeType}`);
    }
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    return { name: data.name, mimeType: data.mimeType, stream: res.data as Readable };
  }
}
