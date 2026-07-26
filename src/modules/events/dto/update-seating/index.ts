import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SeatingTableDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  id!: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(80)
  zone!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;

  @IsArray()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  guestIds!: string[];
}

export class UpdateSeatingDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SeatingTableDto)
  tables!: SeatingTableDto[];
}
