import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { AuthEmailService } from './auth-email.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('auth/email')
export class AuthEmailController {
  constructor(private readonly authEmailService: AuthEmailService) {}

  @Post('otp/send')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authEmailService.sendOtp(dto.email);
  }

  @Post('otp/verify')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authEmailService.verifyOtp(dto.email, dto.code);
  }
}
