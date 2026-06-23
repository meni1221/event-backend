import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$/;

export class RegisterDto {
  @ApiProperty({ example: 'host@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass!123', minLength: 10 })
  @IsString()
  @MinLength(10)
  @Matches(strongPasswordRegex)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'host@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'strong-password-123' })
  @IsString()
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'host@example.com' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token' })
  @IsString()
  token!: string;

  @ApiProperty({ example: 'StrongPass!123', minLength: 10 })
  @IsString()
  @MinLength(10)
  @Matches(strongPasswordRegex)
  password!: string;
}

export class GoogleAuthCallbackDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  error?: string;
}
