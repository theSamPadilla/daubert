import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { UserEntity } from '../../database/entities/user.entity';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: UserEntity | undefined = request.user;
    if (!user) throw new ForbiddenException('Authentication required');
    if (!user.isSuperAdmin) throw new ForbiddenException('Superadmin access required');
    return true;
  }
}
