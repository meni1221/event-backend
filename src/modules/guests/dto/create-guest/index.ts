import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { GuestLanguage } from '../../schemas';

export class CreateGuestDto {
  @ApiProperty({ example: 'דנה כהן', maxLength: 140 })
  @IsString()
  @MaxLength(140)
  fullName!: string;

  @ApiProperty({ example: '0533011599', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  phoneNumber!: string;

  @ApiPropertyOptional({ example: 'guest@example.com', maxLength: 160 })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ enum: GuestLanguage, example: GuestLanguage.HE })
  @IsOptional()
  @IsEnum(GuestLanguage)
  language?: GuestLanguage;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAllowed?: number;

  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  menCount?: number;

  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  womenCount?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  adults?: number;

  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  children?: number;

  @ApiPropertyOptional({ example: 'Needs a baby chair', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
