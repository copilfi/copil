import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from './user.entity';

@Entity('ChatEmbedding')
export class ChatEmbedding {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column({ type: 'text' })
  content!: string;

  // Store embedding as JSON array of numbers to avoid pgvector dependency by default
  @Column({ type: 'jsonb' })
  embedding!: number[];

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.id, { onDelete: 'CASCADE' })
  user!: User;
}

