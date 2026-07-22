import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { requireUserPrincipal } from '../auth/access-principal';
import { RequireOrgRole } from '../auth/require-org-role.decorator';
import { DeclarantsService, DeclarantRequester } from './declarants.service';
import { CreateDeclarantDto } from './dto/create-declarant.dto';
import { UpdateDeclarantDto } from './dto/update-declarant.dto';

@Controller('orgs/:org/declarants')
export class DeclarantsController {
  constructor(private readonly service: DeclarantsService) {}

  @RequireOrgRole('member')
  @Get()
  list(@Req() req: any) {
    return this.service.listForOrg(req.organization.id);
  }

  @RequireOrgRole('member')
  @Post()
  create(@Req() req: any, @Body() dto: CreateDeclarantDto) {
    return this.service.create(req.organization.id, dto, this.requester(req));
  }

  @RequireOrgRole('member')
  @Patch(':declarantId')
  update(@Req() req: any, @Param('declarantId') declarantId: string, @Body() dto: UpdateDeclarantDto) {
    return this.service.update(req.organization.id, declarantId, dto, this.requester(req));
  }

  @RequireOrgRole('member')
  @Delete(':declarantId')
  @HttpCode(204)
  remove(@Req() req: any, @Param('declarantId') declarantId: string) {
    return this.service.remove(req.organization.id, declarantId, this.requester(req));
  }

  /**
   * Build the requester context for row-level self-ownership. The userId comes
   * from the user principal (asserts user auth) and the org role from the
   * membership the OrgRoleGuard attached at `req.orgMembership`.
   */
  private requester(req: any): DeclarantRequester {
    return {
      userId: requireUserPrincipal(req),
      orgRole: req.orgMembership.role,
    };
  }
}
