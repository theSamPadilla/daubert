import {
  Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { IsAdminGuard } from '../../auth/admin.guard';
import { LabeledEntitiesService } from '../../labeled-entities/labeled-entities.service';
import { CreateLabeledEntityDto } from '../../labeled-entities/dto/create-labeled-entity.dto';
import { UpdateLabeledEntityDto } from '../../labeled-entities/dto/update-labeled-entity.dto';

@Controller('admin/labeled-entities')
@UseGuards(IsAdminGuard)
export class AdminLabeledEntitiesController {
  constructor(private readonly service: LabeledEntitiesService) {}

  @Post()
  create(@Body() dto: CreateLabeledEntityDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateLabeledEntityDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
