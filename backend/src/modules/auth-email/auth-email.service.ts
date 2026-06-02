import * as crypto from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as admin from 'firebase-admin';
import { OtpEntity } from '../../database/entities/otp.entity';
import { EmailService } from '../email/email.service';
import { FIREBASE_ADMIN } from '../auth/firebase-admin.provider';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthEmailService {
  constructor(
    @InjectRepository(OtpEntity)
    private readonly otpRepo: Repository<OtpEntity>,
    private readonly emailService: EmailService,
    @Inject(FIREBASE_ADMIN)
    private readonly firebaseAdmin: admin.app.App,
    private readonly usersService: UsersService,
  ) {}

  async sendOtp(email: string): Promise<{ success: true }> {
    const normalizedEmail = email.toLowerCase();

    // Mirror the Google/Microsoft "no account" UX: bail before sending an OTP
    // if there's no Daubert user for this email. Invited users have a shell
    // row pre-created (see InvitesService.create), so this only rejects
    // genuinely uninvited addresses.
    const existingUser = await this.usersService.findByEmail(normalizedEmail);
    if (!existingUser) {
      throw new NotFoundException(
        `No account found for ${normalizedEmail}. Contact our team to get access.`,
      );
    }

    const now = new Date();

    const existing = await this.otpRepo.findOne({
      where: { email: normalizedEmail, verified: false },
      order: { createdAt: 'DESC' },
    });

    let otp: OtpEntity;

    if (existing && existing.expiresAt > now) {
      existing.code = crypto
        .randomInt(100000, 1000000)
        .toString()
        .padStart(6, '0');
      existing.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      otp = await this.otpRepo.save(existing);
    } else {
      const newOtp = this.otpRepo.create({
        email: normalizedEmail,
        code: crypto.randomInt(100000, 1000000).toString().padStart(6, '0'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        verified: false,
      });
      otp = await this.otpRepo.save(newOtp);
    }

    try {
      await this.emailService.sendOtpEmail(normalizedEmail, otp.code);
    } catch {
      await this.otpRepo.delete(otp.id);
      throw new BadGatewayException('Failed to send code, please try again');
    }

    return { success: true };
  }

  async verifyOtp(
    email: string,
    code: string,
  ): Promise<{ success: true; token: string }> {
    const normalizedEmail = email.toLowerCase();
    const now = new Date();

    const otp = await this.otpRepo.findOne({
      where: { email: normalizedEmail, verified: false },
      order: { createdAt: 'DESC' },
    });

    if (!otp) {
      throw new BadRequestException('Invalid or expired code');
    }

    if (otp.expiresAt < now) {
      throw new BadRequestException('Invalid or expired code');
    }

    const storedBuf = Buffer.from(otp.code);
    const inputBuf = Buffer.from(code);

    let codesMatch = false;
    if (storedBuf.length === inputBuf.length) {
      try {
        codesMatch = crypto.timingSafeEqual(storedBuf, inputBuf);
      } catch {
        codesMatch = false;
      }
    }

    if (!codesMatch) {
      throw new BadRequestException('Invalid or expired code');
    }

    otp.verified = true;
    await this.otpRepo.save(otp);

    const token = await this.getFirebaseToken(normalizedEmail);
    return { success: true, token };
  }

  private async getFirebaseToken(email: string): Promise<string> {
    let uid: string;

    try {
      const userRecord = await this.firebaseAdmin.auth().getUserByEmail(email);
      uid = userRecord.uid;
    } catch (err: any) {
      if (err?.errorInfo?.code === 'auth/user-not-found') {
        const newUser = await this.firebaseAdmin
          .auth()
          .createUser({ email, emailVerified: true });
        uid = newUser.uid;
      } else {
        throw err;
      }
    }

    return this.firebaseAdmin.auth().createCustomToken(uid);
  }
}
