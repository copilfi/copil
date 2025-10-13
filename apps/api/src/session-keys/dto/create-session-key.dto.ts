import { IsString, IsOptional, IsObject, IsBoolean, IsDateString } from 'class-validator';

export class CreateSessionKeyDto {
  @IsString()
  publicKey!: string;

  @IsObject()
  @IsOptional()
  permissions?: Record<string, unknown>;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
