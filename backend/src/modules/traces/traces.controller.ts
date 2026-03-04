import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { TracesService } from './traces.service';
import { CreateTraceDto } from './dto/create-trace.dto';
import { UpdateTraceDto } from './dto/update-trace.dto';

@Controller()
export class TracesController {
  constructor(private readonly service: TracesService) {}

  @Get('investigations/:investigationId/traces')
  findAllForInvestigation(@Param('investigationId') investigationId: string) {
    return this.service.findAllForInvestigation(investigationId);
  }

  @Post('investigations/:investigationId/traces')
  create(
    @Param('investigationId') investigationId: string,
    @Body() dto: CreateTraceDto,
  ) {
    return this.service.create(investigationId, dto);
  }

  @Get('traces/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('traces/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTraceDto) {
    return this.service.update(id, dto);
  }

  @Delete('traces/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
