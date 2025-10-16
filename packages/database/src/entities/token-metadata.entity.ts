import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('TokenMetadata')
@Index(['chain', 'address'], { unique: true })
export class TokenMetadata {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  chain!: string; // e.g., 'ethereum', 'base'

  @Column({ type: 'text' })
  address!: string; // token contract address

  @Column({ type: 'text', nullable: true })
  symbol!: string | null;

  @Column({ type: 'int', nullable: true })
  decimals!: number | null;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt!: Date;
}

