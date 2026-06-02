import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequireSuperAdmin } from '../../auth/require-super-admin.decorator';
import { UsersService } from '../../users/users.service';
import { SuperadminUsersService } from './superadmin-users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { SetSuperAdminDto } from './dto/set-super-admin.dto';

/**
 * Superadmin user management. Lifecycle:
 *   1. Superadmin POSTs { email, name } → creates a UserEntity with firebaseUid: null (a "shell").
 *   2. The real person signs in to Firebase with the matching email.
 *   3. The global AuthGuard matches by email and calls UsersService.linkFirebaseUid()
 *      to bind the Firebase UID to the shell row. firebaseUid stays nullable
 *      to support this gap.
 */
@Controller('superadmin/users')
@RequireSuperAdmin()
export class SuperadminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly superadminUsers: SuperadminUsersService,
  ) {}

  @Get()
  async findAll() {
    const all = await this.users.findAll();
    return all.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      linked: !!u.firebaseUid,
      isSuperAdmin: u.isSuperAdmin,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.superadminUsers.createUserShell({ email: dto.email, name: dto.name });
  }

  @Patch(':id/super-admin')
  setSuperAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetSuperAdminDto,
  ) {
    return this.users.setSuperAdmin(id, dto.value);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.delete(id);
  }
}
