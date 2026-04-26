import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { UserEntity } from '../../database/entities/user.entity';
import { ADMIN_EMAIL_DOMAIN } from './admin.constants';

@Injectable()
export class IsAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: UserEntity | undefined = request.user;

    if (!user?.email || user.email.split('@')[1] !== ADMIN_EMAIL_DOMAIN) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
