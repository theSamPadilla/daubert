import { Controller } from '@nestjs/common';

// GET /auth/me now handles user retrieval via AuthController.
// This controller kept for potential future user-management endpoints.
@Controller('users')
export class UsersController {}
