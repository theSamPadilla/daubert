import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { UserEntity } from '../../database/entities/user.entity';

@Injectable()
export class IsAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: UserEntity | undefined = request.user;

    if (!user?.email || user.email.split('@')[1] !== 'incite.ventures') {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
