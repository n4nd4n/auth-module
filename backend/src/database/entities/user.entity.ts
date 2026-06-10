import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { RefreshToken } from './refresh-token.entity';
import { PasswordResetOTP } from './password-reset-otp.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column()
  fullName: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => RefreshToken, (token) => token.user)
  refreshTokens: RefreshToken[];

  @OneToMany(() => PasswordResetOTP, (otp) => otp.user)
  passwordResetOTPs: PasswordResetOTP[];
}
