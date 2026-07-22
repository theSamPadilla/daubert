import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { RequireOrgRole } from '../auth/require-org-role.decorator';
import { DeclarationLibraryService } from './declaration-library.service';
import { CreateDeclarationLibraryBlockDto } from './dto/create-declaration-library-block.dto';
import { UpdateDeclarationLibraryBlockDto } from './dto/update-declaration-library-block.dto';

@Controller('orgs/:org/declaration-library')
export class DeclarationLibraryController {
  constructor(private readonly service: DeclarationLibraryService) {}

  @RequireOrgRole('member')
  @Get()
  list(@Req() req: any) {
    return this.service.listForOrg(req.organization.id);
  }

  @RequireOrgRole('member')
  @Post()
  create(@Req() req: any, @Body() dto: CreateDeclarationLibraryBlockDto) {
    return this.service.create(req.organization.id, dto);
  }

  @RequireOrgRole('member')
  @Patch(':blockId')
  update(@Req() req: any, @Param('blockId') blockId: string, @Body() dto: UpdateDeclarationLibraryBlockDto) {
    return this.service.update(req.organization.id, blockId, dto);
  }

  @RequireOrgRole('member')
  @Delete(':blockId')
  @HttpCode(204)
  remove(@Req() req: any, @Param('blockId') blockId: string) {
    return this.service.remove(req.organization.id, blockId);
  }
}
