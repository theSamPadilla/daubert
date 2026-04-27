import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpCode } from '@nestjs/common';
import { TracesService } from './traces.service';
import { CreateTraceDto } from './dto/create-trace.dto';
import { UpdateTraceDto } from './dto/update-trace.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { UpdateEdgeDto } from './dto/update-edge.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { ImportTransactionsDto } from './dto/import-transactions.dto';
import { getPrincipal } from '../auth/access-principal';

@Controller()
export class TracesController {
  constructor(private readonly service: TracesService) {}

  @Get('investigations/:investigationId/traces')
  findAllForInvestigation(@Param('investigationId') investigationId: string, @Req() req: any) {
    return this.service.findAllForInvestigation(investigationId, getPrincipal(req));
  }

  @Post('investigations/:investigationId/traces')
  create(
    @Param('investigationId') investigationId: string,
    @Body() dto: CreateTraceDto,
    @Req() req: any,
  ) {
    return this.service.create(investigationId, dto, getPrincipal(req));
  }

  @Get('traces/:id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, getPrincipal(req));
  }

  @Patch('traces/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTraceDto, @Req() req: any) {
    return this.service.update(id, dto, getPrincipal(req));
  }

  @Delete('traces/:id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, getPrincipal(req));
  }

  @Patch('traces/:traceId/nodes/:nodeId')
  updateNode(
    @Param('traceId') traceId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateNodeDto,
    @Req() req: any,
  ) {
    return this.service.updateNode(traceId, nodeId, dto, getPrincipal(req));
  }

  @Patch('traces/:traceId/edges/:edgeId')
  updateEdge(
    @Param('traceId') traceId: string,
    @Param('edgeId') edgeId: string,
    @Body() dto: UpdateEdgeDto,
    @Req() req: any,
  ) {
    return this.service.updateEdge(traceId, edgeId, dto, getPrincipal(req));
  }

  @Delete('traces/:traceId/nodes/:nodeId')
  @HttpCode(204)
  deleteNode(
    @Param('traceId') traceId: string,
    @Param('nodeId') nodeId: string,
    @Req() req: any,
  ) {
    return this.service.deleteNode(traceId, nodeId, getPrincipal(req));
  }

  @Delete('traces/:traceId/edges/:edgeId')
  @HttpCode(204)
  deleteEdge(
    @Param('traceId') traceId: string,
    @Param('edgeId') edgeId: string,
    @Req() req: any,
  ) {
    return this.service.deleteEdge(traceId, edgeId, getPrincipal(req));
  }

  @Post('traces/:traceId/groups')
  createGroup(
    @Param('traceId') traceId: string,
    @Body() dto: CreateGroupDto,
    @Req() req: any,
  ) {
    return this.service.createGroup(traceId, dto, getPrincipal(req));
  }

  @Patch('traces/:traceId/groups/:groupId')
  updateGroup(
    @Param('traceId') traceId: string,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto,
    @Req() req: any,
  ) {
    return this.service.updateGroup(traceId, groupId, dto, getPrincipal(req));
  }

  @Delete('traces/:traceId/groups/:groupId')
  @HttpCode(204)
  deleteGroup(
    @Param('traceId') traceId: string,
    @Param('groupId') groupId: string,
    @Req() req: any,
  ) {
    return this.service.deleteGroup(traceId, groupId, getPrincipal(req));
  }

  @Get('traces/:traceId/bundles')
  listEdgeBundles(@Param('traceId') traceId: string, @Req() req: any) {
    return this.service.listEdgeBundles(traceId, getPrincipal(req));
  }

  @Delete('traces/:traceId/bundles/:bundleId')
  @HttpCode(204)
  deleteEdgeBundle(
    @Param('traceId') traceId: string,
    @Param('bundleId') bundleId: string,
    @Req() req: any,
  ) {
    return this.service.deleteEdgeBundle(traceId, bundleId, getPrincipal(req));
  }

  @Post('traces/:id/import-transactions')
  importTransactions(
    @Param('id') id: string,
    @Body() dto: ImportTransactionsDto,
    @Req() req: any,
  ) {
    return this.service.importTransactions(id, dto, getPrincipal(req));
  }
}
