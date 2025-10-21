import { IsString, IsNotEmpty } from 'class-validator';

export class PrepareTransferDto {
  @IsString()
  @IsNotEmpty()
  chain!: string;

  @IsString()
  @IsNotEmpty()
  tokenAddress!: string;

  @IsString()
  @IsNotEmpty()
  fromAddress!: string;

  @IsString()
  @IsNotEmpty()
  toAddress!: string;

  @IsString()
  @IsNotEmpty()
  amount!: string;
}
