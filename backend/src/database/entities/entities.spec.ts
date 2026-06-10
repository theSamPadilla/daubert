import { getMetadataArgsStorage } from 'typeorm';
import { DataRoomFileEntity } from './data-room-file.entity';
import { DataRoomAccessLogEntity } from './data-room-access-log.entity';

describe('data room entities', () => {
  const tables = getMetadataArgsStorage().tables;
  it('map to expected tables', () => {
    expect(tables.find((t) => t.target === DataRoomFileEntity)?.name).toBe('data_room_files');
    expect(tables.find((t) => t.target === DataRoomAccessLogEntity)?.name).toBe('data_room_access_log');
  });
});
