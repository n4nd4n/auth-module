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
import { randomUUID, createHash } from 'crypto';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetOTP } from './entities/password-reset-otp.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { MailService } from '../mail/mail.service';

interface RefreshTokenPayload {
  sub: number;
  email: string;
  jti: string;
}

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

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Verify signature + JWT expiry using the refresh token secret.
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.get('REFRESH_TOKEN_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // The raw token is never stored, so look the row up by its jti and then
    // compare the presented token against the stored bcrypt hash.
    const tokenRecord = await this.refreshTokensRepository.findOne({
      where: { jti: payload.jti, isRevoked: false },
      relations: ['user'],
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isTokenValid = await this.compareToken(refreshToken, tokenRecord.tokenHash);
    if (!isTokenValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Sliding inactivity window: the token is dead once its expiry passes.
    if (new Date(tokenRecord.expiresAt) < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Absolute maximum session age, measured from the original login.
    const sessionAgeMs = Date.now() - new Date(tokenRecord.sessionCreatedAt).getTime();
    if (sessionAgeMs > this.getMaxSessionAgeMs()) {
      throw new UnauthorizedException('Session expired');
    }

    const user = tokenRecord.user;

    // Rotate: revoke the old token and issue a new one with a fresh sliding
    // expiry, carrying the original sessionCreatedAt so the 90-day cap holds.
    await this.refreshTokensRepository.update(tokenRecord.id, { isRevoked: true });

    const tokens = await this.generateTokens(user.id, user.email, tokenRecord.sessionCreatedAt);

    return {
      message: 'Token refreshed successfully',
      ...tokens,
    };
  }

  async logout(refreshToken: string) {
    if (!refreshToken) {
      return { message: 'Logout successful' };
    }

    // Best-effort revocation: decode (without verifying) to recover the jti.
    const decoded = this.jwtService.decode(refreshToken) as RefreshTokenPayload | null;
    if (decoded?.jti) {
      await this.refreshTokensRepository.update(
        { jti: decoded.jti },
        { isRevoked: true },
      );
    }

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

  // Maximum absolute session age (in ms), read from MAX_SESSION_AGE_DAYS.
  // A plain number (e.g. "90") is interpreted as a number of days for backward
  // compatibility. A duration string with a unit (e.g. "6h", "90d", "30m",
  // "45s") is parsed by unit, so the cap can be expressed at any granularity.
  private getMaxSessionAgeMs(): number {
    const raw = (this.configService.get('MAX_SESSION_AGE_DAYS') || '90').trim();

    if (/^\d+$/.test(raw)) {
      return parseInt(raw, 10) * 24 * 60 * 60 * 1000;
    }

    return this.parseExpiryToMs(raw);
  }

  // bcrypt only hashes the first 72 bytes and a refresh JWT is longer than
  // that, so pre-hash with SHA-256 to a fixed-length digest before bcrypt.
  private async hashToken(token: string): Promise<string> {
    const digest = createHash('sha256').update(token).digest('hex');
    return bcrypt.hash(digest, 10);
  }

  private async compareToken(token: string, hash: string): Promise<boolean> {
    const digest = createHash('sha256').update(token).digest('hex');
    return bcrypt.compare(digest, hash);
  }

  // Generates a signed accessToken (short-lived) and a signed refreshToken (long-lived).
  // Persists only a bcrypt hash of the refresh token, keyed by a unique jti, so the
  // raw token never touches the database. On refresh, sessionCreatedAt is carried over
  // so the absolute session age cap survives rotation, while expiresAt slides forward.
  private async generateTokens(userId: number, email: string, sessionCreatedAt?: Date) {
    const jti = randomUUID();

    const accessToken = this.jwtService.sign(
      { sub: userId, email },
      {
        expiresIn: this.configService.get('JWT_EXPIRES_IN') || '15m',
        secret: this.configService.get('JWT_SECRET'),
      },
    );

    const refreshTokenExpiry = this.configService.get('REFRESH_TOKEN_EXPIRES_IN') || '7d';
    const refreshToken = this.jwtService.sign(
      { sub: userId, email, jti },
      {
        expiresIn: refreshTokenExpiry,
        secret: this.configService.get('REFRESH_TOKEN_SECRET'),
      },
    );

    const expiresAt = new Date(Date.now() + this.parseExpiryToMs(refreshTokenExpiry));

    await this.refreshTokensRepository.save({
      jti,
      tokenHash: await this.hashToken(refreshToken),
      userId,
      user: await this.usersRepository.findOne({ where: { id: userId } }),
      expiresAt,
      sessionCreatedAt: sessionCreatedAt || new Date(),
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
