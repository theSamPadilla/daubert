import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';
import { AuthModule } from '../auth/auth.module';
import { DataRoomController } from './data-room.controller';
import { DataRoomService } from './data-room.service';
import { GoogleDriveService } from './google-drive.service';
import { EncryptionService } from './encryption.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DataRoomConnectionEntity]),
    // CaseMemberGuard is provided + exported by AuthModule; importing it here
    // makes the guard usable without re-registering its dependencies.
    AuthModule,
  ],
  controllers: [DataRoomController],
  providers: [DataRoomService, GoogleDriveService, EncryptionService],
  exports: [DataRoomService],
})
export class DataRoomModule {}
