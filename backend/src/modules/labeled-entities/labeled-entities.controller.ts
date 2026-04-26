import {
  Controller, Get, Param, Query, BadRequestException,
} from '@nestjs/common';
import { LabeledEntitiesService } from './labeled-entities.service';
import { EntityCategory } from '../../database/entities/labeled-entity.entity';

const VALID_CATEGORIES = new Set(Object.values(EntityCategory));

/**
 * Read-only registry endpoints. Any authenticated user can hit these.
 * Admin-only CUD lives at /admin/labeled-entities/* (see AdminLabeledEntitiesController).
 */
@Controller('labeled-entities')
export class LabeledEntitiesController {
  constructor(private readonly service: LabeledEntitiesService) {}

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
}
