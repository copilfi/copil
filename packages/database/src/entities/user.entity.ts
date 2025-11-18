import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { Wallet } from './wallet.entity';
import { Strategy } from './strategy.entity';
import { TransactionLog } from './transaction-log.entity';
import { SessionKey } from './session-key.entity';

export type UserRole = 'admin' | 'operator' | 'user' | 'readonly';

@Entity('User')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ type: 'text', unique: true, name: 'privyDid' })
  privyDid!: string;

  @Column({ 
    type: 'enum', 
    enum: ['admin', 'operator', 'user', 'readonly'],
    default: 'user'
  })
  role!: UserRole;

  @Column({ type: 'jsonb', nullable: true, default: null })
  allowedIPs?: string[];

  @Column({ type: 'boolean', default: false })
  isWhitelisted?: boolean;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @Column({ type: 'bigint', nullable: true, default: null })
  dailyLimit?: bigint;

  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets!: Wallet[];

  @OneToMany(() => Strategy, (strategy) => strategy.user)
  strategies!: Strategy[];

  @OneToMany(() => TransactionLog, (log) => log.user)
  transactionLogs!: TransactionLog[];

  @OneToMany(() => SessionKey, (sessionKey) => sessionKey.user)
  sessionKeys!: SessionKey[];
}
