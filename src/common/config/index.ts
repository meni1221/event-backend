import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const supportedEnvironments = new Set(['development', 'test', 'production']);
const booleanKeys = ['ENABLE_SWAGGER', 'LOG_TO_DB'] as const;
const positiveIntegerKeys = ['PORT', 'API_RATE_LIMIT_MAX', 'API_RATE_LIMIT_TTL_MS', 'SMTP_PORT'] as const;
const nonNegativeIntegerKeys = ['TRUST_PROXY_HOPS'] as const;
const productionRequiredKeys = [
  'MONGODB_URI',
  'OWNER_EMAILS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_AUTH_REDIRECT_URI',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
] as const;

const readEnvironmentValue = (environment: Record<string, unknown>, key: string) => {
  const value = environment[key];
  return typeof value === 'string' ? value.trim() : value;
};

const isHttpUrl = (value: unknown, requireHttps: boolean) => {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  try {
    const url = new URL(value);
    return requireHttps ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const validateInteger = (
  environment: Record<string, unknown>,
  key: string,
  minimum: number,
  errors: string[],
) => {
  const value = readEnvironmentValue(environment, key);
  if (value === undefined || value === '') {
    return;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    errors.push(`${key} must be an integer greater than or equal to ${minimum}`);
    return;
  }

  environment[key] = parsed;
};

export const validateEnvironment = (source: Record<string, unknown>) => {
  const environment = { ...source };
  const errors: string[] = [];
  const nodeEnv = readEnvironmentValue(environment, 'NODE_ENV') || 'development';
  const isProduction = nodeEnv === 'production';

  if (typeof nodeEnv !== 'string' || !supportedEnvironments.has(nodeEnv)) {
    errors.push('NODE_ENV must be development, test, or production');
  }
  environment.NODE_ENV = nodeEnv;

  for (const key of positiveIntegerKeys) {
    validateInteger(environment, key, 1, errors);
  }
  for (const key of nonNegativeIntegerKeys) {
    validateInteger(environment, key, 0, errors);
  }
  for (const key of booleanKeys) {
    const value = readEnvironmentValue(environment, key);
    if (value !== undefined && value !== '' && value !== 'true' && value !== 'false') {
      errors.push(`${key} must be true or false`);
    }
  }

  const frontendOrigins = String(readEnvironmentValue(environment, 'FRONTEND_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!frontendOrigins.length) {
    errors.push('FRONTEND_ORIGIN is required');
  } else if (frontendOrigins.some((origin) => !isHttpUrl(origin, isProduction))) {
    errors.push(`FRONTEND_ORIGIN must contain valid ${isProduction ? 'HTTPS' : 'HTTP(S)'} URLs`);
  }

  const jwtSecret = String(readEnvironmentValue(environment, 'JWT_SECRET') ?? '');
  if (jwtSecret.length < 32 || ['replace-me-in-production', 'change-this-secret'].includes(jwtSecret)) {
    errors.push('JWT_SECRET must contain at least 32 characters and must not use a placeholder');
  }

  if (isProduction) {
    for (const key of productionRequiredKeys) {
      if (!readEnvironmentValue(environment, key)) {
        errors.push(`${key} is required in production`);
      }
    }

    for (const key of ['GOOGLE_REDIRECT_URI', 'GOOGLE_AUTH_REDIRECT_URI', 'MAIL_LOGO_URL'] as const) {
      const value = readEnvironmentValue(environment, key);
      if (value && !isHttpUrl(value, true)) {
        errors.push(`${key} must be a valid HTTPS URL in production`);
      }
    }

    const ownerEmails = String(readEnvironmentValue(environment, 'OWNER_EMAILS') ?? '')
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);
    if (ownerEmails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      errors.push('OWNER_EMAILS must contain valid comma-separated email addresses');
    }

    const mongoUri = String(readEnvironmentValue(environment, 'MONGODB_URI') ?? '');
    if (mongoUri && !mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
      errors.push('MONGODB_URI must use the mongodb or mongodb+srv protocol');
    }
  }

  if (errors.length) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }

  return environment;
};

export const getRequiredConfig = (config: ConfigService, key: string) => {
  const value = config.get<string>(key)?.trim();
  if (!value) {
    throw new InternalServerErrorException(`${key} is not configured`);
  }

  return value;
};

export const getRequiredJwtSecret = (config: ConfigService) => {
  const secret = getRequiredConfig(config, 'JWT_SECRET');
  if (secret === 'replace-me-in-production' || secret === 'change-this-secret') {
    throw new InternalServerErrorException('JWT_SECRET must be changed before the server can start');
  }

  return secret;
};
