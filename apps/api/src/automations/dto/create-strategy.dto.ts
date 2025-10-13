import { IsString, IsOptional, IsBoolean, IsNotEmpty, IsDefined } from 'class-validator';

export class CreateStrategyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsDefined()
  definition!: unknown;

  @IsString()
  @IsOptional()
  schedule?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
