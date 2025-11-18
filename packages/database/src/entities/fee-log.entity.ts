import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { FeeLogData } from '../types/fee.types';

/**
 * Fee log entity for tracking and analytics
 * Records all fee collections for transparency and compliance
 */
@Entity('FeeLog')
@Index(['userId', 'chain'])
@Index(['createdAt'])
@Index(['transactionHash'])
export class FeeLog implements FeeLogData {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'text' })
  chain!: string;

  @Column({ type: 'text' })
  transactionType!: string;

  @Column({ type: 'bigint' })
  originalAmount!: bigint;

  @Column({ type: 'bigint' })
  feeAmount!: bigint;

  @Column({ type: 'decimal', precision: 4, scale: 3 })
  feePercentage!: number;

  @Column({ type: 'text', nullable: true })
  transactionHash?: string;

  @Column({ type: 'decimal', precision: 3, scale: 2 })
  roleDiscount!: number;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;
}
