import {
  Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { RequireOrgRole } from '../../auth/require-org-role.decorator';
import { LabeledEntitiesService } from '../../labeled-entities/labeled-entities.service';
import { CreateLabeledEntityDto } from '../../labeled-entities/dto/create-labeled-entity.dto';
import { UpdateLabeledEntityDto } from '../../labeled-entities/dto/update-labeled-entity.dto';

@Controller('admin/labeled-entities')
@RequireOrgRole('admin')
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
