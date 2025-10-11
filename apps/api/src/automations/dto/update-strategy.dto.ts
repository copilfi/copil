import { PartialType } from '@nestjs/mapped-types';
import { CreateStrategyDto } from './create-strategy.dto';

export class UpdateStrategyDto extends PartialType(CreateStrategyDto) {}
