import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { ProductionsModule } from '../productions/productions.module';

@Module({
  imports: [ProductionsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
