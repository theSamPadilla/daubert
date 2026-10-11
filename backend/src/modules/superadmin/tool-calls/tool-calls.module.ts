import { Module } from '@nestjs/common';
import { SuperadminToolCallsController } from './tool-calls.controller';
import { ToolCallsService } from './tool-calls.service';

@Module({
  controllers: [SuperadminToolCallsController],
  providers: [ToolCallsService],
})
export class ToolCallsModule {}
