import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeclarantEntity } from '../../database/entities/declarant.entity';
import { DeclarantFileEntity } from '../../database/entities/declarant-file.entity';
import { AuthModule } from '../auth/auth.module';
import { AnthropicProvider } from '../ai/providers/anthropic.provider';
import { TokenUsageModule } from '../superadmin/token-usage/token-usage.module';
import { storageProvider } from '../data-room/storage/storage.factory';
import { DeclarantsController } from './declarants.controller';
import { DeclarantsService } from './declarants.service';
import { DeclarantFilesService } from './declarant-files.service';
import { DeclarantExtractionService } from './declarant-extraction.service';

@Module({
  // AnthropicProvider is added to providers directly (NOT via AiModule) — AiModule
  // already imports DeclarantsModule, so importing it back would create a cycle.
  // AnthropicProvider is self-contained (only depends on the global ConfigService).
  // TokenUsageModule exports TokenUsageService for the extraction metering step.
  imports: [
    TypeOrmModule.forFeature([DeclarantEntity, DeclarantFileEntity]),
    AuthModule,
    TokenUsageModule,
  ],
  controllers: [DeclarantsController],
  providers: [
    DeclarantsService,
    DeclarantFilesService,
    DeclarantExtractionService,
    AnthropicProvider,
    storageProvider,
  ],
  exports: [DeclarantsService],
})
export class DeclarantsModule {}
