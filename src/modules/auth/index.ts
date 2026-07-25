import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { getRequiredJwtSecret } from '../../common/config';
import { Admin, AdminSchema } from '../admin/schemas';
import { MailModule } from '../mail';
import { AuthController } from './controller';
import { AuthService } from './service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth';
import { SessionAuthorizationService } from './session-authorization';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Admin.name, schema: AdminSchema }]),
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getRequiredJwtSecret(config),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    SessionAuthorizationService,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
  exports: [AuthService, SessionAuthorizationService],
})
export class AuthModule {}
