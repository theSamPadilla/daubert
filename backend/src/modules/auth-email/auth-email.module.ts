import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { OtpEntity } from '../../database/entities/otp.entity';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AuthEmailController } from './auth-email.controller';
import { AuthEmailService } from './auth-email.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpEntity]),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    EmailModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [AuthEmailController],
  providers: [AuthEmailService],
})
export class AuthEmailModule {}
