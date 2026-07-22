import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { DeclarationFormatsController } from './declaration-formats.controller';
import { ExportService } from './export.service';
import { ProductionsModule } from '../productions/productions.module';
import { InvestigationsModule } from '../investigations/investigations.module';

@Module({
  imports: [ProductionsModule, InvestigationsModule],
  controllers: [ExportController, DeclarationFormatsController],
  providers: [ExportService],
})
export class ExportModule {}
