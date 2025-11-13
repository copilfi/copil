import { IsOptional, IsArray, ArrayNotEmpty, IsString, ArrayUnique, IsIn, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class SpendLimitDto {
  @IsString()
  token!: string;

  @IsString()
  maxAmount!: string; // in smallest unit

  @IsOptional()
  @IsNumber()
  windowSec?: number;
}

export class SessionKeyPermissionsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(['swap', 'bridge', 'custom', 'transfer', 'open_position', 'close_position'], { each: true })
  actions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  chains?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  allowedContracts?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpendLimitDto)
  spendLimits?: SpendLimitDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  // Hyperliquid-specific policy extensions (optional)
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  hlAllowedMarkets?: string[];

  @IsOptional()
  @IsNumber()
  hlMaxUsdPerTrade?: number;
}
