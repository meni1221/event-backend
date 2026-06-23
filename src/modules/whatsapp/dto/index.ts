import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

const phoneNumberPattern = /^\+?[0-9\s().-]{7,32}$/;
const connectionIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;

export class WhatsappConnectionQueryDto {
  @ApiPropertyOptional({ example: 'default', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(connectionIdPattern)
  connectionId?: string;
}

export class WhatsappRecipientDto {
  @ApiProperty({ example: '0533011599', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  @Matches(phoneNumberPattern)
  phoneNumber!: string;

  @ApiPropertyOptional({ example: 'דנה כהן', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ example: 'http://localhost:4310/invite/665f1a2b3c4d5e6f7a8b9c0d/inv_dana_001', maxLength: 500 })
  @ValidateIf((_object, value) => value !== undefined && value !== '')
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_tld: false, require_protocol: true })
  inviteLink?: string;

  @ApiPropertyOptional({ example: '665f1a2b3c4d5e6f7a8b9c0d', maxLength: 48 })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  guestId?: string;
}

export class SendWhatsappBatchDto {
  @ApiPropertyOptional({ example: 'default', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(connectionIdPattern)
  connectionId?: string;

  @ApiPropertyOptional({ example: '665f1a2b3c4d5e6f7a8b9c0d', maxLength: 48 })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  eventId?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowResend?: boolean;

  @ApiProperty({ type: [WhatsappRecipientDto], maxItems: 250 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => WhatsappRecipientDto)
  recipients!: WhatsappRecipientDto[];

  @ApiProperty({ example: 'שלום {fullName}, הנה הקישור האישי שלך: {inviteLink}', maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({ example: 2500, minimum: 1000, maximum: 120000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  minDelayMs?: number;

  @ApiPropertyOptional({ example: 5000, minimum: 1500, maximum: 180000 })
  @IsOptional()
  @IsInt()
  @Min(1500)
  @Max(180000)
  maxDelayMs?: number;
}

export class SendWhatsappTestDto {
  @ApiPropertyOptional({ example: 'default', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(connectionIdPattern)
  connectionId?: string;

  @ApiProperty({ example: '0533011599', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  @Matches(phoneNumberPattern)
  phoneNumber!: string;

  @ApiProperty({ example: 'שלום, זו הודעת בדיקה מ-WhatsApp.', maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
