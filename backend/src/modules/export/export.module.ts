import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { DeclarationFormatsController } from './declaration-formats.controller';
import { RedlineController } from './redline.controller';
import { ExportService } from './export.service';
import { ProductionsModule } from '../productions/productions.module';
import { InvestigationsModule } from '../investigations/investigations.module';
import { DataRoomModule } from '../data-room/data-room.module';

@Module({
  imports: [ProductionsModule, InvestigationsModule, DataRoomModule],
  controllers: [ExportController, DeclarationFormatsController, RedlineController],
  providers: [ExportService],
})
export class ExportModule {}
