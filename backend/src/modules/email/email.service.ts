import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly replyTo: string | undefined;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set');
    }
    this.from = process.env.EMAIL_FROM_ADDRESS ?? 'Daubert AI <noreply@example.com>';
    this.replyTo = process.env.EMAIL_REPLY_TO;
    this.resend = new Resend(apiKey);
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    const templatePath = path.resolve(__dirname, 'templates', 'otp.html');
    let html: string;
    try {
      html = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to read OTP email template at ${templatePath}`, err);
      throw new InternalServerErrorException('Email template not found');
    }

    const year = new Date().getFullYear().toString();
    // FRONTEND_URL serves the public logo at /logo.png. In dev this is
    // localhost (image won't load in real email clients — alt text covers it).
    const frontendUrl = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '');
    const logoUrl = frontendUrl ? `${frontendUrl}/logo.png` : '';
    html = html
      .replace(/\{\{code\}\}/g, code)
      .replace(/\{\{year\}\}/g, year)
      .replace(/\{\{logoUrl\}\}/g, logoUrl);

    const payload: Parameters<Resend['emails']['send']>[0] = {
      from: this.from,
      to,
      subject: 'Your Daubert sign-in code',
      html,
    };
    if (this.replyTo) {
      payload.replyTo = this.replyTo;
    }

    const { error } = await this.resend.emails.send(payload);
    if (error) {
      this.logger.error(`Resend error sending OTP to ${to}`, error);
      throw new InternalServerErrorException(`Failed to send OTP email: ${error.message}`);
    }
  }
}
