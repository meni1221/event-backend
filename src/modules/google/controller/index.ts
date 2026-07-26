import { Controller, Get, HttpCode, Post, Query, Redirect } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { CurrentHost } from '../../../common/decorators/current-host';
import { Public } from '../../../common/decorators/public';
import { ApiProtectedOperation, ApiPublicOperation } from '../../../common/swagger/operations';
import { AuthService } from '../../auth/service';
import { GoogleService } from '../service';

@ApiTags('Google')
@Controller('google')
export class GoogleController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleService: GoogleService,
  ) {}

  @Get('status')
  @ApiProtectedOperation('Get the current host Google Contacts connection status')
  @ApiBearerAuth('access-token')
  getStatus(@CurrentHost() host: { hostId: string }) {
    return this.googleService.getStatus(host.hostId);
  }

  @Get('connect')
  @ApiProtectedOperation('Create a Google Contacts authorization URL')
  @ApiBearerAuth('access-token')
  connect(@CurrentHost() host: { hostId: string }) {
    return this.googleService.createAuthUrl(host.hostId);
  }

  @Get('contacts')
  @ApiProtectedOperation('List contacts from the connected Google account')
  @ApiBearerAuth('access-token')
  getContacts(@CurrentHost() host: { hostId: string }) {
    return this.googleService.getContacts(host.hostId);
  }

  @Post('disconnect')
  @ApiProtectedOperation('Disconnect Google Contacts and remove stored credentials')
  @HttpCode(StatusCodes.OK)
  @ApiBearerAuth('access-token')
  disconnect(@CurrentHost() host: { hostId: string }) {
    return this.googleService.disconnect(host.hostId);
  }

  @Get('callback')
  @ApiPublicOperation('Complete Google sign-in or Contacts authorization')
  @Public()
  @Redirect()
  async callback(@Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string) {
    if (this.authService.isGoogleLoginState(state)) {
      const url = await this.authService.handleGoogleCallback(code, state, error);
      return { url };
    }

    const redirectUrl = await this.googleService.handleCallback(code, state);
    return { url: `${redirectUrl}?google=connected` };
  }
}
