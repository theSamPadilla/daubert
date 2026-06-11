import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataRoomFileEntity } from '../../database/entities/data-room-file.entity';
import { DataRoomAccessLogEntity } from '../../database/entities/data-room-access-log.entity';
import { DataRoomFolderEntity } from '../../database/entities/data-room-folder.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { AuthModule } from '../auth/auth.module';
import { DataRoomController } from './data-room.controller';
import { DataRoomService } from './data-room.service';
import { GoogleDriveImportService } from './google-drive-import.service';
import { GoogleDriveExportService } from './google-drive-export.service';
import { storageProvider } from './storage/storage.factory';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DataRoomFileEntity,
      DataRoomAccessLogEntity,
      DataRoomFolderEntity,
      CaseEntity,
    ]),
    // RoleGuard is provided + exported by AuthModule; importing it here
    // makes the guard usable without re-registering its dependencies.
    AuthModule,
  ],
  controllers: [DataRoomController],
  providers: [DataRoomService, GoogleDriveImportService, GoogleDriveExportService, storageProvider],
  exports: [DataRoomService],
})
export class DataRoomModule {}
