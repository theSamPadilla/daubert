import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CasesModule } from './modules/cases/cases.module';
import { InvestigationsModule } from './modules/investigations/investigations.module';
import { TracesModule } from './modules/traces/traces.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { AiModule } from './modules/ai/ai.module';
import { LabeledEntitiesModule } from './modules/labeled-entities/labeled-entities.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    CasesModule,
    InvestigationsModule,
    TracesModule,
    BlockchainModule,
    AiModule,
    LabeledEntitiesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
