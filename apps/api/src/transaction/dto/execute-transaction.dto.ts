import { TransactionIntent } from '@copil/database';
import { IsInt, IsNotEmpty, IsObject } from 'class-validator';

export class ExecuteTransactionDto {
  @IsObject()
  @IsNotEmpty()
  intent!: TransactionIntent;

  @IsInt()
  @IsNotEmpty()
  sessionKeyId!: number;
}
