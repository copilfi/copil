import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { Wallet } from './wallet.entity';
import { Strategy } from './strategy.entity';
import { TransactionLog } from './transaction-log.entity';

@Entity('User')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ type: 'text', unique: true, name: 'privyDid' })
  privyDid!: string;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets!: Wallet[];

  @OneToMany(() => Strategy, (strategy) => strategy.user)
  strategies!: Strategy[];

  @OneToMany(() => TransactionLog, (log) => log.user)
  transactionLogs!: TransactionLog[];
}
