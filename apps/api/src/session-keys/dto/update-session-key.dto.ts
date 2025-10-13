import { IsBoolean, IsDateString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionKeyPermissionsDto } from './permissions.dto';

export class UpdateSessionKeyDto {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @ValidateNested()
  @Type(() => SessionKeyPermissionsDto)
  @IsOptional()
  permissions?: SessionKeyPermissionsDto;
}
