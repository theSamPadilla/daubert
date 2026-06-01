import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RequireRole } from '../auth/require-role.decorator';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @RequireRole('owner')
  @Post('cases/:caseId/invites')
  create(@Param('caseId') caseId: string, @Body() dto: CreateInviteDto, @Req() req: any) {
    return this.invites.create(caseId, req.user.id, dto);
  }

  @RequireRole('owner')
  @Get('cases/:caseId/invites')
  list(@Param('caseId') caseId: string) {
    return this.invites.listPending(caseId);
  }

  @RequireRole('owner')
  @Delete('cases/:caseId/invites/:inviteId')
  @HttpCode(204)
  revoke(@Param('caseId') caseId: string, @Param('inviteId') inviteId: string) {
    return this.invites.revoke(caseId, inviteId);
  }

  @Public()
  @Get('invites/:code')
  lookup(@Param('code') code: string) {
    return this.invites.lookup(code);
  }

  @Post('invites/:code/accept')
  accept(@Param('code') code: string, @Req() req: any) {
    // Authenticated through AuthGuard. req.user is the Firebase user.
    return this.invites.accept(code, req.user.email, req.user.id);
  }
}
