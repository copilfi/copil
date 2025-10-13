import { IsOptional, IsArray, ArrayNotEmpty, IsString, ArrayUnique, IsIn } from 'class-validator';

export class SessionKeyPermissionsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(['swap', 'bridge', 'custom'], { each: true })
  actions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  chains?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
