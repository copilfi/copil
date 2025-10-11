import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Unique } from 'typeorm';
import { User } from './user.entity';

@Entity('Wallet')
@Unique(['userId', 'chain'])
export class Wallet {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column({ type: 'text' })
  address!: string;

  @Column({ type: 'text' })
  chain!: string; // e.g., 'ethereum', 'base', 'sei'

  @ManyToOne(() => User, (user) => user.wallets)
  user!: User;
}
