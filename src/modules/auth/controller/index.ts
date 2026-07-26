import { Body, Controller, Get, HttpCode, Post, Query, Redirect } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public';
import { routeRateLimits } from '../../../common/security';
import { ApiPublicOperation } from '../../../common/swagger/operations';
import { ForgotPasswordDto, GoogleAuthCallbackDto, LoginDto, RegisterDto, ResetPasswordDto } from '../dto';
import { AuthService } from '../service';

@ApiTags('Auth')
@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiPublicOperation('Register a host account for owner approval')
  @Throttle(routeRateLimits.auth.register)
  @HttpCode(StatusCodes.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiPublicOperation('Authenticate an approved admin with email and password')
  @Throttle(routeRateLimits.auth.login)
  @HttpCode(StatusCodes.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @ApiPublicOperation('Request a password reset email without revealing account existence')
  @Throttle(routeRateLimits.auth.forgotPassword)
  @HttpCode(StatusCodes.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiPublicOperation('Reset a password with a valid single-use token')
  @Throttle(routeRateLimits.auth.resetPassword)
  @HttpCode(StatusCodes.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('google')
  @ApiPublicOperation('Create the official Google sign-in authorization URL')
  @Throttle(routeRateLimits.auth.googleStart)
  @HttpCode(StatusCodes.OK)
  googleAuthUrl() {
    return this.authService.createGoogleAuthUrl();
  }

  @Get('google/callback')
  @ApiPublicOperation('Complete Google sign-in and redirect to the frontend')
  @Redirect()
  async googleCallback(@Query() query: GoogleAuthCallbackDto) {
    const url = await this.authService.handleGoogleCallback(query.code, query.state, query.error);
    return { url };
  }
}
