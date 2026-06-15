import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn()
  id: number;

  // Unique token identifier embedded in the refresh JWT (jti claim).
  // Used to look up the row since the raw token is never stored.
  @Index({ unique: true })
  @Column()
  jti: string;

  // bcrypt hash of the refresh token. The raw token is never persisted,
  // so a database leak does not expose usable refresh tokens.
  @Column()
  tokenHash: string;

  @Column()
  userId: number;

  @ManyToOne(() => User, (user) => user.refreshTokens)
  @JoinColumn({ name: 'userId' })
  user: User;

  // Sliding expiry: reset to now + REFRESH_TOKEN_EXPIRES_IN on every rotation.
  @Column()
  expiresAt: Date;

  // Timestamp of the original login. Carried across rotations and never
  // changed, so it can be used to enforce the absolute maximum session age.
  @Column()
  sessionCreatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: false })
  isRevoked: boolean;
}
