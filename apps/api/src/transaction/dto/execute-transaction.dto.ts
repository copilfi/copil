import { TransactionIntent } from '@copil/database';
import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class ExecuteTransactionDto {
  @IsObject()
  @IsNotEmpty()
  intent!: TransactionIntent;

  @IsInt()
  @IsNotEmpty()
  sessionKeyId!: number;

  // Idempotency key to de-duplicate execute requests (optional)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9_.:-]+$/)
  idempotencyKey?: string;
}
