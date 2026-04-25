import { Controller, Get, Req } from '@nestjs/common';
import { UserEntity } from '../../database/entities/user.entity';

@Controller('auth')
export class AuthController {
  @Get('me')
  getMe(@Req() req: any): UserEntity {
    return req.user;
  }
}
