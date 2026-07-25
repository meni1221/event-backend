import { validateEnvironment } from '.';

const createProductionEnvironment = (): Record<string, unknown> => ({
  NODE_ENV: 'production',
  PORT: '3000',
  TRUST_PROXY_HOPS: '1',
  ENABLE_SWAGGER: 'false',
  API_RATE_LIMIT_MAX: '120',
  API_RATE_LIMIT_TTL_MS: '60000',
  MONGODB_URI: 'mongodb+srv://database.example.com/ishru',
  FRONTEND_ORIGIN: 'https://ishru.example.com',
  JWT_SECRET: 'a-production-secret-with-more-than-32-characters',
  OWNER_EMAILS: 'owner@example.com',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  GOOGLE_REDIRECT_URI: 'https://api.ishru.example.com/api/google/callback',
  GOOGLE_AUTH_REDIRECT_URI: 'https://api.ishru.example.com/api/auth/google/callback',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-password',
  SMTP_FROM: 'Ishru <no-reply@example.com>',
  MAIL_LOGO_URL: 'https://ishru.example.com/brand/ishru-logo.jpeg',
  LOG_TO_DB: 'true',
});

describe('validateEnvironment', () => {
  it('accepts a complete production environment and normalizes integers', () => {
    const environment = validateEnvironment(createProductionEnvironment());

    expect(environment.PORT).toBe(3000);
    expect(environment.TRUST_PROXY_HOPS).toBe(1);
    expect(environment.SMTP_PORT).toBe(587);
  });

  it('rejects missing production integrations', () => {
    const environment = createProductionEnvironment();
    environment.GOOGLE_CLIENT_SECRET = '';

    expect(() => validateEnvironment(environment)).toThrow('GOOGLE_CLIENT_SECRET is required in production');
  });

  it('rejects weak JWT secrets', () => {
    const environment = createProductionEnvironment();
    environment.JWT_SECRET = 'change-this-secret';

    expect(() => validateEnvironment(environment)).toThrow('JWT_SECRET must contain at least 32 characters');
  });

  it('requires HTTPS origins and callback URLs in production', () => {
    const environment = createProductionEnvironment();
    environment.FRONTEND_ORIGIN = 'http://ishru.example.com';
    environment.GOOGLE_AUTH_REDIRECT_URI = 'http://api.ishru.example.com/api/auth/google/callback';

    expect(() => validateEnvironment(environment)).toThrow('FRONTEND_ORIGIN must contain valid HTTPS URLs');
    expect(() => validateEnvironment(environment)).toThrow('GOOGLE_AUTH_REDIRECT_URI must be a valid HTTPS URL');
  });

  it('rejects malformed operational values in development', () => {
    expect(() => validateEnvironment({
      NODE_ENV: 'development',
      FRONTEND_ORIGIN: 'http://localhost:4310',
      JWT_SECRET: 'a-local-secret-with-more-than-32-characters',
      PORT: '3000.5',
      LOG_TO_DB: 'yes',
    })).toThrow('PORT must be an integer greater than or equal to 1');
  });
});
