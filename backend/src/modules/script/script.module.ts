import { Module } from '@nestjs/common';
import { ScriptTokenService } from './script-token.service';

@Module({
  providers: [ScriptTokenService],
  exports: [ScriptTokenService],
})
export class ScriptModule {}
