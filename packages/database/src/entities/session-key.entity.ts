import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';
import { SessionKeyPermissions } from '../types/session-key-permissions';
import { v4 as uuidv4 } from 'uuid';

@Entity('SessionKey')
export class SessionKey {
  @PrimaryColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column({ type: 'text', unique: true })
  publicKey!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  permissions!: SessionKeyPermissions;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.sessionKeys, { onDelete: 'CASCADE' })
  user!: User;
}
