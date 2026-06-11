import { Injectable } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';

@Injectable()
export class GoogleDriveExportService {
  private drive(accessToken: string): drive_v3.Drive {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  }

  /**
   * Create a file in the user's Drive from a byte stream. `destinationFolderId`
   * null → file lands in My Drive root (still within the drive.file scope).
   */
  async uploadToFolder(
    accessToken: string,
    name: string,
    mimeType: string,
    stream: Readable,
    destinationFolderId: string | null,
  ): Promise<{ id: string; webViewLink: string | null }> {
    const drive = this.drive(accessToken);
    const res = await drive.files.create({
      requestBody: {
        name,
        ...(destinationFolderId ? { parents: [destinationFolderId] } : {}),
      },
      media: { mimeType, body: stream },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    return { id: res.data.id as string, webViewLink: res.data.webViewLink ?? null };
  }
}
