import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('TokenPrice')
@Index(['chain', 'address'])
export class TokenPrice {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  chain!: string;

  @Column({ type: 'text' })
  address!: string;

  @Column({ type: 'text' })
  symbol!: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  priceUsd!: number;

  @Column({ type: 'text', nullable: true })
  source?: string;

  @CreateDateColumn()
  timestamp!: Date;
}
