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
  address!: string; // This is the EOA address from Privy

  @Column({ type: 'text', nullable: true })
  smartAccountAddress?: string; // This will be the ERC-4337 address

    @Column({ type: 'text' })

    chain!: string; // e.g., 'ethereum', 'base', 'sei'

  

    @Column({ type: 'varchar', default: 'smart-account' })

    type!: 'smart-account' | 'eoa';

  

    @ManyToOne(() => User, (user) => user.wallets)

    user!: User;

  }

  