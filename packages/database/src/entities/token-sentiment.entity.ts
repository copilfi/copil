import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('TokenSentiment')
export class TokenSentiment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'text' })
  chain!: string;

  @Index()
  @Column({ type: 'text' })
  symbol!: string;

  @Column({ type: 'float' })
  sentimentScore!: number; // e.g., average sentiment score from -1 to 1

  @Column({ type: 'int' })
  tweetVolume!: number; // Number of tweets analyzed in the period

  @CreateDateColumn()
  timestamp!: Date;
}
