import { Body, Controller, Get, HttpCode, Post, Query, Redirect } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public';
import { routeRateLimits } from '../../../common/security';
import { ForgotPasswordDto, GoogleAuthCallbackDto, LoginDto, RegisterDto, ResetPasswordDto } from '../dto';
import { AuthService } from '../service';

@ApiTags('Auth')
@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(routeRateLimits.auth.register)
  @HttpCode(StatusCodes.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle(routeRateLimits.auth.login)
  @HttpCode(StatusCodes.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @Throttle(routeRateLimits.auth.forgotPassword)
  @HttpCode(StatusCodes.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle(routeRateLimits.auth.resetPassword)
  @HttpCode(StatusCodes.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('google')
  @Throttle(routeRateLimits.auth.googleStart)
  @HttpCode(StatusCodes.OK)
  googleAuthUrl() {
    return this.authService.createGoogleAuthUrl();
  }

  @Get('google/callback')
  @Redirect()
  async googleCallback(@Query() query: GoogleAuthCallbackDto) {
    const url = await this.authService.handleGoogleCallback(query.code, query.state, query.error);
    return { url };
  }
}
