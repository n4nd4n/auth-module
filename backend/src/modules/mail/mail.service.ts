import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MAIL_TEMPLATES } from './mail.constants';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    // console.log('Email Config:', {
    //   host: this.configService.get('EMAIL_HOST'),
    //   port: this.configService.get('EMAIL_PORT'),
    //   user: this.configService.get('EMAIL_USER'),
    //   passwordLength: this.configService.get('EMAIL_PASSWORD')?.length,
    // });

    this.transporter = nodemailer.createTransport({
      host: this.configService.get('EMAIL_HOST'),
      port: parseInt(this.configService.get('EMAIL_PORT')),
      secure: false,
      auth: {
        user: this.configService.get('EMAIL_USER'),
        pass: this.configService.get('EMAIL_PASSWORD'),
      },
    });
  }

  async sendPasswordResetOTP(email: string, otp: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get('EMAIL_FROM'),
      to: email,
      subject: MAIL_TEMPLATES.PASSWORD_RESET_OTP.subject,
      text: MAIL_TEMPLATES.PASSWORD_RESET_OTP.text(otp),
    });
  }

  async sendEmail(to: string, subject: string, text: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get('EMAIL_FROM'),
      to,
      subject,
      text,
    });
  }
}
