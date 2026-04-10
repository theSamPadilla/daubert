import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode } from '@nestjs/common';
import { TracesService } from './traces.service';
import { CreateTraceDto } from './dto/create-trace.dto';
import { UpdateTraceDto } from './dto/update-trace.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { UpdateEdgeDto } from './dto/update-edge.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { ImportTransactionsDto } from './dto/import-transactions.dto';

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

  @Patch('traces/:traceId/nodes/:nodeId')
  updateNode(
    @Param('traceId') traceId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.service.updateNode(traceId, nodeId, dto);
  }

  @Patch('traces/:traceId/edges/:edgeId')
  updateEdge(
    @Param('traceId') traceId: string,
    @Param('edgeId') edgeId: string,
    @Body() dto: UpdateEdgeDto,
  ) {
    return this.service.updateEdge(traceId, edgeId, dto);
  }

  @Delete('traces/:traceId/nodes/:nodeId')
  @HttpCode(204)
  deleteNode(
    @Param('traceId') traceId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.service.deleteNode(traceId, nodeId);
  }

  @Post('traces/:traceId/groups')
  createGroup(
    @Param('traceId') traceId: string,
    @Body() dto: CreateGroupDto,
  ) {
    return this.service.createGroup(traceId, dto);
  }

  @Patch('traces/:traceId/groups/:groupId')
  updateGroup(
    @Param('traceId') traceId: string,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.service.updateGroup(traceId, groupId, dto);
  }

  @Delete('traces/:traceId/groups/:groupId')
  @HttpCode(204)
  deleteGroup(
    @Param('traceId') traceId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.service.deleteGroup(traceId, groupId);
  }

  @Post('traces/:id/import-transactions')
  importTransactions(
    @Param('id') id: string,
    @Body() dto: ImportTransactionsDto,
  ) {
    return this.service.importTransactions(id, dto);
  }
}
