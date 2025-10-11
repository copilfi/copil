import { IsString, IsObject, IsOptional, IsBoolean, IsNotEmpty } from 'class-validator';

export class CreateStrategyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsObject()
  @IsNotEmpty()
  definition!: object;

  @IsString()
  @IsOptional()
  schedule?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
