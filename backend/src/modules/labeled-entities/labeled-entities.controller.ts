import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, HttpCode, BadRequestException,
} from '@nestjs/common';
import { IsAdminGuard } from '../auth/admin.guard';
import { LabeledEntitiesService } from './labeled-entities.service';
import { CreateLabeledEntityDto } from './dto/create-labeled-entity.dto';
import { UpdateLabeledEntityDto } from './dto/update-labeled-entity.dto';
import { EntityCategory } from '../../database/entities/labeled-entity.entity';

const VALID_CATEGORIES = new Set(Object.values(EntityCategory));

@Controller('labeled-entities')
export class LabeledEntitiesController {
  constructor(private readonly service: LabeledEntitiesService) {}

  // --- Read (any authenticated user) ---

  @Get()
  findAll(
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    if (category && !VALID_CATEGORIES.has(category as EntityCategory)) {
      throw new BadRequestException(`Invalid category: ${category}`);
    }
    return this.service.findAll({ category: category as EntityCategory, search });
  }

  @Get('lookup')
  lookupByAddress(@Query('address') address?: string) {
    if (!address) {
      throw new BadRequestException('address query parameter is required');
    }
    return this.service.lookupByAddress(address);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // --- CUD (admin only) ---

  @Post()
  @UseGuards(IsAdminGuard)
  create(@Body() dto: CreateLabeledEntityDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(IsAdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateLabeledEntityDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(IsAdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
