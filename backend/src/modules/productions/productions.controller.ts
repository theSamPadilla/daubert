import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, Req, HttpCode, BadRequestException, UseGuards,
} from '@nestjs/common';
import { CaseMemberGuard } from '../auth/case-member.guard';
import { ProductionsService } from './productions.service';
import { CreateProductionDto } from './dto/create-production.dto';
import { UpdateProductionDto } from './dto/update-production.dto';
import { ProductionType } from '../../database/entities/production.entity';

const VALID_TYPES = new Set(Object.values(ProductionType));

@Controller()
export class ProductionsController {
  constructor(private readonly service: ProductionsService) {}

  @UseGuards(CaseMemberGuard)
  @Get('cases/:caseId/productions')
  findAllForCase(
    @Param('caseId') caseId: string,
    @Query('type') type?: string,
    @Req() req?: any,
  ) {
    if (type && !VALID_TYPES.has(type as ProductionType)) {
      throw new BadRequestException(`Invalid type: ${type}`);
    }
    return this.service.findAllForCase(
      caseId, req?.user?.id, type as ProductionType | undefined,
    );
  }

  @UseGuards(CaseMemberGuard)
  @Post('cases/:caseId/productions')
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateProductionDto,
    @Req() req: any,
  ) {
    return this.service.create(caseId, dto, req.user?.id);
  }

  @Get('productions/:id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user?.id);
  }

  @Patch('productions/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductionDto, @Req() req: any) {
    return this.service.update(id, dto, req.user?.id);
  }

  @Delete('productions/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user?.id);
  }
}
