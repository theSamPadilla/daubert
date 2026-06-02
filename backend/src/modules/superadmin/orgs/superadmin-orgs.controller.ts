import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequireSuperAdmin } from '../../auth/require-super-admin.decorator';
import { SuperadminOrgsService } from './superadmin-orgs.service';
import { CreateOrgDto } from './dto/create-org.dto';

@Controller('superadmin/orgs')
@RequireSuperAdmin()
export class SuperadminOrgsController {
  constructor(private readonly orgsService: SuperadminOrgsService) {}

  @Get()
  list() {
    return this.orgsService.list();
  }

  @Get('trash')
  listTrash() {
    return this.orgsService.listTrash();
  }

  @Post()
  create(@Body() dto: CreateOrgDto) {
    return this.orgsService.createWithFirstAdmin({
      name: dto.name,
      slug: dto.slug,
      firstAdminEmail: dto.firstAdminEmail,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  softDelete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orgsService.softDelete(id);
  }

  @Post(':id/restore')
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orgsService.restore(id);
  }

  @Post(':id/purge')
  @HttpCode(204)
  purge(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orgsService.purge(id);
  }
}
