import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';
import { Strategy } from './strategy.entity';

@Entity('TransactionLog')
export class TransactionLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column({ nullable: true })
  strategyId?: number;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text', nullable: true })
  txHash?: string;

  @Column({ type: 'text', nullable: true })
  chain?: string;

  @Column({ type: 'text' })
  status!: string; // e.g., 'pending', 'success', 'failed'

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.transactionLogs)
  user!: User;

  @ManyToOne(() => Strategy)
  strategy!: Strategy;

}
