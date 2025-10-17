import { TransactionIntent } from '@copil/database';
import { IsObject, IsNotEmpty } from 'class-validator';

export class GetQuoteDto {
  @IsObject()
  @IsNotEmpty()
  intent!: TransactionIntent;
}
