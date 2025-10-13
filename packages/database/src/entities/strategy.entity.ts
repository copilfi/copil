import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';
import { StrategyDefinition } from '../types/strategy-definition';

@Entity('Strategy')
export class Strategy {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'jsonb' })
  definition!: StrategyDefinition; // Rules, triggers, actions

  @Column({ type: 'text', nullable: true })
  schedule?: string; // Cron format

  @Column({ default: true, name: 'isActive' })
  isActive!: boolean;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.strategies)
  user!: User;
}
