import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { PasswordResetOTP } from '../../database/entities/password-reset-otp.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokensRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetOTP)
    private passwordResetOTPRepository: Repository<PasswordResetOTP>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { fullName, email, password, confirmPassword } = registerDto;

    if (password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const existingUser = await this.usersRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = this.usersRepository.create({
      fullName,
      email,
      password: hashedPassword,
    });

    await this.usersRepository.save(user);

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      message: 'Registration successful',
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      },
      ...tokens,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Cleanup expired tokens on every login to prevent DB bloat
    await this.cleanupExpiredTokens();

    const user = await this.usersRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      },
      ...tokens,
    };
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    const tokenRecord = await this.refreshTokensRepository.findOne({
      where: { token: refreshToken, isRevoked: false },
      relations: ['user'],
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check session expiry (original login time + max session duration)
    if (new Date(tokenRecord.sessionExpiresAt) < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    const user = tokenRecord.user;

    // Revoke old refresh token
    await this.refreshTokensRepository.update(tokenRecord.id, { isRevoked: true });

    // Generate new tokens with the same sessionExpiresAt (no extension)
    const tokens = await this.generateTokens(user.id, user.email, tokenRecord.sessionExpiresAt);

    return {
      message: 'Token refreshed successfully',
      ...tokens,
    };
  }

  async logout(refreshToken: string) {
    await this.refreshTokensRepository.update(
      { token: refreshToken },
      { isRevoked: true },
    );

    return { message: 'Logout successful' };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    const user = await this.usersRepository.findOne({
      where: { email },
    });

    if (!user) {
      return { message: 'If email exists, OTP will be sent' };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.passwordResetOTPRepository.save({
      otp: hashedOTP,
      userId: user.id,
      user,
      expiresAt,
      attempts: 0,
      isUsed: false,
    });

    await this.mailService.sendPasswordResetOTP(email, otp);

    return { message: 'OTP sent to email' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { email, otp, newPassword, confirmNewPassword } = resetPasswordDto;

    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.usersRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('Invalid email');
    }

    const otpRecord = await this.passwordResetOTPRepository.findOne({
      where: { userId: user.id, isUsed: false },
      order: { createdAt: 'DESC' },
    });

    if (!otpRecord) {
      throw new BadRequestException('No valid OTP found');
    }

    if (new Date(otpRecord.expiresAt) < new Date()) {
      throw new BadRequestException('OTP expired');
    }

    if (otpRecord.attempts >= 5) {
      throw new BadRequestException('Maximum OTP attempts exceeded');
    }

    const isOTPValid = await bcrypt.compare(otp, otpRecord.otp);

    if (!isOTPValid) {
      await this.passwordResetOTPRepository.update(otpRecord.id, {
        attempts: otpRecord.attempts + 1,
      });
      throw new BadRequestException('Invalid OTP');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.usersRepository.update(user.id, { password: hashedPassword });

    await this.passwordResetOTPRepository.update(otpRecord.id, { isUsed: true });

    await this.refreshTokensRepository.update(
      { userId: user.id },
      { isRevoked: true },
    );

    return { message: 'Password reset successful' };
  }

  // Parses expiry strings like "15s", "1m", "7d" into milliseconds.
  // Used to calculate the DB expiresAt value so it always matches
  // the REFRESH_TOKEN_EXPIRES_IN value set in .env.
  private parseExpiryToMs(expiry: string): number {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1), 10);
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] ?? 1000);
  }

  // Generates a signed accessToken (short-lived) and a signed refreshToken (long-lived).
  // Saves the refreshToken to DB with its expiry so it can be validated and revoked.
  // Expiry durations are read from .env (JWT_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN).
  private async generateTokens(userId: number, email: string, sessionExpiresAt?: Date) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN') || '15m',
      secret: this.configService.get('JWT_SECRET'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('REFRESH_TOKEN_EXPIRES_IN') || '7d',
      secret: this.configService.get('REFRESH_TOKEN_SECRET'),
    });

    const refreshTokenExpiry = this.configService.get('REFRESH_TOKEN_EXPIRES_IN') || '7d';
    const expiryMs = this.parseExpiryToMs(refreshTokenExpiry);
    const expiresAt = new Date(
      Date.now() + expiryMs,
    );

    // If sessionExpiresAt is provided (refresh), use it; otherwise create new (login)
    const finalSessionExpiresAt = sessionExpiresAt || expiresAt;

    // console.log('Refresh token expiry config:', refreshTokenExpiry);
    // console.log('Parsed expiry in ms:', expiryMs);
    // console.log('Expires at:', expiresAt);
    // console.log('Session expires at:', finalSessionExpiresAt);

    await this.refreshTokensRepository.save({
      token: refreshToken,
      userId,
      user: await this.usersRepository.findOne({ where: { id: userId } }),
      expiresAt,
      sessionExpiresAt: finalSessionExpiresAt,
      isRevoked: false,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  // Deletes expired refresh tokens from the DB.
  // Called on every login to prevent accumulation of stale records.
  async cleanupExpiredTokens() {
    await this.refreshTokensRepository.delete({
      expiresAt: LessThan(new Date()),
    });
  }
}
