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
import { ProductionsModule } from './modules/productions/productions.module';
import { SuperadminModule } from './modules/superadmin/superadmin.module';
import { ExportModule } from './modules/export/export.module';
import { DataRoomModule } from './modules/data-room/data-room.module';
import { ExternalTraceModule } from './modules/external-trace/external-trace.module';
import { InvitesModule } from './modules/invites/invites.module';
import { ScriptModule } from './modules/script/script.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { EmailModule } from './modules/email/email.module';
import { AuthEmailModule } from './modules/auth-email/auth-email.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { McpModule } from './modules/mcp/mcp.module';
import { DeclarationLibraryModule } from './modules/declaration-library/declaration-library.module';
import { DeclarantsModule } from './modules/declarants/declarants.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    OAuthModule,
    McpModule,
    UsersModule,
    CasesModule,
    InvestigationsModule,
    TracesModule,
    BlockchainModule,
    AiModule,
    LabeledEntitiesModule,
    ProductionsModule,
    SuperadminModule,
    ExportModule,
    DataRoomModule,
    ExternalTraceModule,
    InvitesModule,
    ScriptModule,
    OrganizationsModule,
    EmailModule,
    AuthEmailModule,
    DeclarationLibraryModule,
    DeclarantsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
