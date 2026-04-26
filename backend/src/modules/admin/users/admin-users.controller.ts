import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsAdminGuard } from '../../auth/admin.guard';
import { UsersService } from '../../users/users.service';
import { AdminUsersService } from './admin-users.service';
import { CreateUserDto } from './dto/create-user.dto';

/**
 * Admin user management. Lifecycle:
 *   1. Admin POSTs { email, name } → creates a UserEntity with firebaseUid: null (a "shell").
 *   2. The real person signs in to Firebase with the matching email.
 *   3. The global AuthGuard matches by email and calls UsersService.linkFirebaseUid()
 *      to bind the Firebase UID to the shell row. firebaseUid stays nullable
 *      to support this gap.
 */
@Controller('admin/users')
@UseGuards(IsAdminGuard)
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly adminUsers: AdminUsersService,
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
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.adminUsers.createWithOptionalMembership({
      email: dto.email,
      name: dto.name,
      caseId: dto.caseId,
      role: dto.caseRole,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.delete(id);
  }
}
