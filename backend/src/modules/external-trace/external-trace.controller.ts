import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { TraceQueryDto } from './dto/trace-query.dto';
import { ExternalTraceService } from './external-trace.service';
import { WebsiteKeyGuard } from './website-key.guard';
import { ForwardedIpThrottlerGuard } from './forwarded-ip.guard';

@Controller('external/trace')
@UseGuards(ForwardedIpThrottlerGuard, WebsiteKeyGuard)
export class ExternalTraceController {
  constructor(private readonly service: ExternalTraceService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get()
  trace(@Query() query: TraceQueryDto) {
    return this.service.trace(query.address, query.chain, query.hops);
  }
}
