import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from '../common/config';
import { getPositiveInteger } from '../common/security';
import { AdminModule } from '../modules/admin';
import { AuthModule } from '../modules/auth';
import { EventsModule } from '../modules/events';
import { GuestsModule } from '../modules/guests';
import { GoogleModule } from '../modules/google';
import { LogsModule } from '../modules/logs';
import { HealthModule } from '../modules/health';
import { WhatsappModule } from '../modules/whatsapp';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          limit: getPositiveInteger(config.get<string>('API_RATE_LIMIT_MAX'), 120),
          ttl: getPositiveInteger(config.get<string>('API_RATE_LIMIT_TTL_MS'), 60_000),
        },
      ],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/ishru',
      }),
    }),
    LogsModule,
    AdminModule,
    AuthModule,
    EventsModule,
    GuestsModule,
    GoogleModule,
    HealthModule,
    WhatsappModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
