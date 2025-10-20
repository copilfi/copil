import { IsString, IsOptional, Matches } from 'class-validator';

export class FundPlanDto {
  @IsString() targetChain!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{40}$/) safeAddress!: `0x${string}`;
  @IsString() fromChain!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{40}$/) fromToken!: `0x${string}`;
  @IsString() @Matches(/^[0-9]+$/) fromAmount!: string;
  @IsOptional() @IsString() toToken?: string;
}

export class FundQuoteDto extends FundPlanDto {}

export class PrepareNativeDto {
  @IsString() chain!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{40}$/) to!: `0x${string}`;
  @IsString() @Matches(/^[0-9]+$/) valueWei!: string;
}

export class PrepareErc20Dto {
  @IsString() chain!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{40}$/) token!: `0x${string}`;
  @IsString() @Matches(/^0x[0-9a-fA-F]{40}$/) to!: `0x${string}`;
  @IsString() @Matches(/^[0-9]+$/) amount!: string;
}
