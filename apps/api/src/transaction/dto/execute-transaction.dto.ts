import { TransactionAction } from '@copil/database';
import { IsInt, IsNotEmpty, IsObject } from 'class-validator';

export class ExecuteTransactionDto {
  @IsObject()
  @IsNotEmpty()
  action!: TransactionAction;

  @IsInt()
  @IsNotEmpty()
  sessionKeyId!: number;
}
