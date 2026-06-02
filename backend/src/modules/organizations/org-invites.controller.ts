import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RequireOrgRole } from '../auth/require-org-role.decorator';
import { OrgInvitesService } from './org-invites.service';
import { CreateOrgInviteDto } from './dto/create-org-invite.dto';

@Controller()
export class OrgInvitesController {
  constructor(private readonly invites: OrgInvitesService) {}

  @RequireOrgRole('admin')
  @Post('orgs/:org/invites')
  create(@Req() req: any, @Body() dto: CreateOrgInviteDto) {
    return this.invites.create(req.organization.id, req.user.id, dto);
  }

  @RequireOrgRole('admin')
  @Get('orgs/:org/invites')
  list(@Req() req: any) {
    return this.invites.listPending(req.organization.id);
  }

  @RequireOrgRole('admin')
  @Delete('orgs/:org/invites/:inviteId')
  @HttpCode(204)
  revoke(@Req() req: any, @Param('inviteId') inviteId: string) {
    return this.invites.revoke(req.organization.id, inviteId);
  }

  @Public()
  @Get('org-invites/:code')
  lookup(@Param('code') code: string) {
    return this.invites.lookup(code);
  }

  @Post('org-invites/:code/accept')
  accept(@Param('code') code: string, @Req() req: any) {
    return this.invites.accept(code, req.user.email, req.user.id);
  }
}
