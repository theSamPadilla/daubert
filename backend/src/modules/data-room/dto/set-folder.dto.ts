import { IsString, Matches } from 'class-validator';

/**
 * Folder ID submitted from the frontend after the user pastes a Google Drive
 * folder URL. The frontend regex extracts the ID; this DTO defends against
 * obvious junk before we burn a Drive API call. Backend re-validates by
 * calling `files.get(folderId)` — see `DataRoomService.setFolder`.
 */
export class SetFolderDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{20,}$/, {
    message: 'folderId must be a valid Drive folder ID (alphanumeric, _, -, length >= 20).',
  })
  folderId: string;
}
