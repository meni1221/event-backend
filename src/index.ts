import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { getRequiredConfig } from './common/config';
import { getPositiveInteger } from './common/security';
import { setupSwagger } from './common/swagger';
import { AppModule } from './app';

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const trustProxyHops = getPositiveInteger(config.get<string>('TRUST_PROXY_HOPS'), 0);

  app.setGlobalPrefix('api');
  app.use(helmet());
  if (trustProxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  }
  const allowedOrigins = getRequiredConfig(config, 'FRONTEND_ORIGIN')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  if (!isProduction || config.get<string>('ENABLE_SWAGGER') === 'true') {
    setupSwagger(app);
  }

  await app.listen(config.get<number>('PORT') ?? 3000);
};

void bootstrap().catch((cause) => {
  const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
  process.stderr.write(`[bootstrap] Failed to start Ishru backend\n${message}\n`);
  process.exit(1);
});
