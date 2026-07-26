import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ example: 'table_a1', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  id!: string;

  @ApiProperty({ example: 'Family table', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'Near the stage', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  zone!: string;

  @ApiProperty({ example: 10, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;

  @ApiProperty({ type: [String], description: 'MongoDB guest ids assigned to this table', maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  guestIds!: string[];
}

export class UpdateSeatingDto {
  @ApiProperty({ type: [SeatingTableDto], maxItems: 500 })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SeatingTableDto)
  tables!: SeatingTableDto[];
}
