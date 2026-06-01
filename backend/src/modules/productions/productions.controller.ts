import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, Req, HttpCode, BadRequestException,
} from '@nestjs/common';
import { RequireRole } from '../auth/require-role.decorator';
import { getPrincipal } from '../auth/access-principal';
import { ProductionsService } from './productions.service';
import { CreateProductionDto } from './dto/create-production.dto';
import { UpdateProductionDto } from './dto/update-production.dto';
import { ProductionType } from '../../database/entities/production.entity';

const VALID_TYPES = new Set(Object.values(ProductionType));

@Controller()
export class ProductionsController {
  constructor(private readonly service: ProductionsService) {}

  @RequireRole('viewer')
  @Get('cases/:caseId/productions')
  findAllForCase(
    @Param('caseId') caseId: string,
    @Req() req: any,
    @Query('type') type?: string,
  ) {
    if (type && !VALID_TYPES.has(type as ProductionType)) {
      throw new BadRequestException(`Invalid type: ${type}`);
    }
    return this.service.findAllForCase(
      caseId, getPrincipal(req), type as ProductionType | undefined,
    );
  }

  @RequireRole('editor')
  @Post('cases/:caseId/productions')
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateProductionDto,
    @Req() req: any,
  ) {
    return this.service.create(caseId, dto, getPrincipal(req));
  }

  @Get('productions/:id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, getPrincipal(req));
  }

  @Patch('productions/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductionDto, @Req() req: any) {
    return this.service.update(id, dto, getPrincipal(req));
  }

  @Delete('productions/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, getPrincipal(req));
  }
}
