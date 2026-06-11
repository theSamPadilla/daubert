import { getMetadataArgsStorage } from 'typeorm';
import { DataRoomFileEntity } from './data-room-file.entity';
import { DataRoomFolderEntity } from './data-room-folder.entity';
import { DataRoomAccessLogEntity } from './data-room-access-log.entity';

describe('data room entities', () => {
  const storage = getMetadataArgsStorage();
  const tables = storage.tables;

  it('map to expected tables', () => {
    expect(tables.find((t) => t.target === DataRoomFileEntity)?.name).toBe('data_room_files');
    expect(tables.find((t) => t.target === DataRoomAccessLogEntity)?.name).toBe('data_room_access_log');
  });

  it('DataRoomFolderEntity maps to data_room_folders', () => {
    expect(tables.find((t) => t.target === DataRoomFolderEntity)?.name).toBe('data_room_folders');
  });

  it('DataRoomFileEntity has a folder_id column', () => {
    const fileColumns = storage.columns.filter((c) => c.target === DataRoomFileEntity);
    const folderIdCol = fileColumns.find(
      (c) => c.propertyName === 'folderId' || (c.options as any).name === 'folder_id',
    );
    expect(folderIdCol).toBeDefined();
  });
});
