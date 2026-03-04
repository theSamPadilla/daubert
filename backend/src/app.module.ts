import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AppController } from './app.controller';
import { CasesModule } from './modules/cases/cases.module';
import { InvestigationsModule } from './modules/investigations/investigations.module';
import { TracesModule } from './modules/traces/traces.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CasesModule,
    InvestigationsModule,
    TracesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
