/**
 * Temporary local type used by the Google-Drive OAuth data-room service while
 * the module is being rewritten (Task 3 of the built-in-data-room plan).
 * Do NOT import this outside the data-room module. Will be deleted in Task 3.
 */

export type DataRoomStatus = 'active' | 'broken';

export class DataRoomConnectionEntity {
  id: string;
  caseId: string;
  provider: string;
  credentialsCipher: Buffer;
  credentialsIv: Buffer;
  credentialsAuthTag: Buffer;
  folderId: string | null;
  folderName: string | null;
  status: DataRoomStatus;
  createdAt: Date;
  updatedAt: Date;
}
