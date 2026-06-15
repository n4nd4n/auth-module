import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('password_reset_otps')
export class PasswordResetOTP {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  otp: string;

  @Column()
  userId: number;

  @ManyToOne(() => User, (user) => user.passwordResetOTPs)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: 0 })
  attempts: number;

  @Column({ default: false })
  isUsed: boolean;
}
