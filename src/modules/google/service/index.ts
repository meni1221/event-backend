import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Model } from 'mongoose';
import { getRequiredJwtSecret } from '../../../common/config';
import { Admin, AdminDocument } from '../../admin/schemas';
import { googleScopes } from '../constants';
import { mapGooglePeopleToContacts } from '../mappers';
import { GoogleOAuthState, GooglePeopleResponse, GoogleUserInfoResponse } from '../types';

@Injectable()
export class GoogleService {
  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<AdminDocument>,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async getStatus(hostId: string) {
    const admin = await this.adminModel.findById(hostId).select('googleConnection').exec();
    if (!admin) {
      throw new NotFoundException('Host admin was not found');
    }

    return {
      connected: Boolean(admin.googleConnection?.refreshToken),
      googleAccountEmail: admin.googleConnection?.googleAccountEmail,
      connectedAt: admin.googleConnection?.connectedAt,
    };
  }

  createAuthUrl(hostId: string) {
    return {
      authUrl: this.getOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: googleScopes.join(' '),
      state: this.createSignedState(hostId),
      }),
    };
  }

  async handleCallback(code: string | undefined, state: string | undefined) {
    if (!code || !state) {
      throw new BadRequestException('Missing Google OAuth code or state');
    }

    const oauthClient = this.getOAuthClient();
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google did not return a refresh token. Disconnect and approve consent again.');
    }

    const googleAccountEmail = tokens.id_token
      ? (await oauthClient.verifyIdToken({
          idToken: tokens.id_token,
          audience: this.getRequiredConfig('GOOGLE_CLIENT_ID'),
        })).getPayload()?.email
      : tokens.access_token
      ? await this.getGoogleAccountEmail(tokens.access_token)
      : undefined;

    const oauthState = await this.verifySignedState(state);

    await this.adminModel
      .findByIdAndUpdate(oauthState.hostId, {
        googleConnection: {
          googleAccountEmail,
          refreshToken: tokens.refresh_token,
          scopes: tokens.scope?.split(' ') ?? googleScopes,
          connectedAt: new Date(),
        },
      })
      .exec();

    return this.config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:4310';
  }

  async disconnect(hostId: string) {
    await this.adminModel.findByIdAndUpdate(hostId, { googleConnection: null }).exec();
    return { connected: false };
  }

  async getContacts(hostId: string) {
    const admin = await this.adminModel.findById(hostId).select('googleConnection').exec();
    const refreshToken = admin?.googleConnection?.refreshToken;
    if (!refreshToken) {
      return { contacts: [] };
    }

    const accessToken = await this.refreshAccessToken(refreshToken);
    const response = await fetch(
      'https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers,emailAddresses&pageSize=500',
      { headers: { authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new BadRequestException(await response.text());
    }

    const data = (await response.json()) as GooglePeopleResponse;
    const contacts = mapGooglePeopleToContacts(data.connections ?? []);

    return { contacts };
  }

  private async getGoogleAccountEmail(accessToken: string) {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as GoogleUserInfoResponse;
    return data.email;
  }

  private async refreshAccessToken(refreshToken: string) {
    const oauthClient = this.getOAuthClient();
    oauthClient.setCredentials({ refresh_token: refreshToken });
    const accessToken = await oauthClient.getAccessToken();
    if (!accessToken.token) {
      throw new BadRequestException('Google did not return an access token');
    }

    return accessToken.token;
  }

  private getRedirectUri() {
    return this.config.get<string>('GOOGLE_REDIRECT_URI') ?? 'http://localhost:3000/api/google/callback';
  }

  private getOAuthClient() {
    return new OAuth2Client(
      this.getRequiredConfig('GOOGLE_CLIENT_ID'),
      this.getRequiredConfig('GOOGLE_CLIENT_SECRET'),
      this.getRedirectUri(),
    );
  }

  private createSignedState(hostId: string) {
    return this.jwt.sign(
      {
        hostId,
        nonce: randomUUID(),
        purpose: 'google_oauth',
      } satisfies GoogleOAuthState,
      {
        expiresIn: '10m',
        secret: getRequiredJwtSecret(this.config),
      },
    );
  }

  private async verifySignedState(state: string) {
    try {
      const payload = await this.jwt.verifyAsync<GoogleOAuthState>(state, {
        secret: getRequiredJwtSecret(this.config),
      });

      if (payload.purpose !== 'google_oauth' || !payload.hostId || !payload.nonce) {
        throw new Error('Invalid Google OAuth state payload');
      }

      return payload;
    } catch {
      throw new BadRequestException('Invalid or expired Google OAuth state');
    }
  }

  private getRequiredConfig(key: string) {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new BadRequestException(`${key} is not configured`);
    }

    return value;
  }
}
