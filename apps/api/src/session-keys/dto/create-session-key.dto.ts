import { IsString, IsOptional, IsBoolean, IsDateString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionKeyPermissionsDto } from './permissions.dto';

export class CreateSessionKeyDto {
  @IsString()
  publicKey!: string;

  @ValidateNested()
  @Type(() => SessionKeyPermissionsDto)
  @IsOptional()
  permissions?: SessionKeyPermissionsDto;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
