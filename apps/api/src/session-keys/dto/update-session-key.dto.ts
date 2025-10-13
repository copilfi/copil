import { IsBoolean, IsDateString, IsObject, IsOptional } from 'class-validator';

export class UpdateSessionKeyDto {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsObject()
  @IsOptional()
  permissions?: Record<string, unknown>;
}
