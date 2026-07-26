# Ishru Backend

NestJS API for the Ishru multi-tenant event platform.

Track launch blockers and the next engineering priorities in [Production Readiness](docs/production-readiness.md).

## Responsibilities

- Auth and admin approval flow
- Event and guest management
- Public guest RSVP endpoints
- WhatsApp session management per host
- WhatsApp message queueing per host
- Google Contacts OAuth integration
- Invitation email sending
- Backend and frontend log ingestion

## Requirements

- Node.js 24.16+
- MongoDB
- SMTP credentials for real email delivery

## Environment

Create a local environment file:

```bash
copy .env.example .env
```

Important values:

```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/ishru
FRONTEND_ORIGIN=http://localhost:4310
JWT_SECRET=local-development-secret-at-least-32-characters
OWNER_EMAILS=owner@example.com,second-owner@example.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
GOOGLE_AUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Ishru <no-reply@ishru.local>
MAIL_LOGO_URL=http://localhost:4310/brand/ishru-logo.jpeg
LOG_LEVEL=info
LOG_TO_DB=true
```

`OWNER_EMAILS` controls which users become super admins and who receives admin approval request emails.

Google uses two separate OAuth callbacks:

- `GOOGLE_AUTH_REDIRECT_URI` handles application sign-in.
- `GOOGLE_REDIRECT_URI` handles Google Contacts access for an authenticated host.

## Production Configuration

The server validates its environment before connecting to MongoDB or accepting traffic. Production startup fails with a list of configuration keys to fix when a required integration is missing or malformed.

Before setting `NODE_ENV=production`:

- Generate a unique `JWT_SECRET` containing at least 32 characters.
- Set an HTTPS `FRONTEND_ORIGIN`. Multiple origins may be comma-separated.
- Configure MongoDB, Google OAuth, owner emails, and SMTP credentials.
- Use HTTPS for both Google redirect URIs and `MAIL_LOGO_URL`.
- Register the exact Google redirect URIs in Google Cloud Console.
- Keep real secrets in the deployment platform environment, never in `.env.example` or Git.

After a Google client secret is exposed, revoke it in Google Cloud Console and deploy a newly generated secret.

## Development

```bash
npm install
npm run start:dev
```

Local API docs:

```text
http://localhost:3000/api/docs
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Frontend Contract

The deployed frontend origin must be configured in:

```env
FRONTEND_ORIGIN=https://your-frontend.example.com
MAIL_LOGO_URL=https://your-frontend.example.com/brand/ishru-logo.jpeg
```

The frontend should point to this backend with:

```env
VITE_API_BASE_URL=https://your-backend.example.com/api
```

## Session Security

- Protected HTTP routes are authenticated by default. Only routes marked with `@Public()` bypass session validation.
- Every protected request verifies the account status, current role, and session version against MongoDB.
- Password changes and password resets increment the session version and revoke previously issued tokens.
- Tokens issued before session versioning was introduced are intentionally rejected. Users must sign in again after the first deployment of this version.
- WebSocket connections use the same database-backed session authorization as REST requests.

## Health Checks

The health endpoints are public, return no sensitive configuration, and disable response caching:

```http
GET /api/health/live
GET /api/health/ready
```

- Use `/api/health/live` as the liveness probe. It confirms that the Node.js process can respond.
- Use `/api/health/ready` as the readiness probe. It returns `200` only when MongoDB is connected and `503` otherwise.
- Remove an instance from traffic when readiness fails, but restart it only when liveness fails.

Nest shutdown hooks are enabled so deployment platforms can stop the application and close managed resources cleanly.

## MongoDB Backup and Recovery

Install MongoDB Database Tools and make `mongodump` and `mongorestore` available on `PATH`. The commands read `MONGODB_URI` from the environment and never print it.

Create a compressed archive in `backups/` or `MONGODB_BACKUP_DIR`:

```bash
npm run db:backup
```

Validate an archive and preview a restore without changing data:

```bash
npm run db:restore -- --archive=backups/ishru-TIMESTAMP.archive.gz
```

Execute a confirmed restore that replaces collections contained in the archive:

```bash
npm run db:restore -- --archive=backups/ishru-TIMESTAMP.archive.gz --execute --confirm=RESTORE
```

- Store archives outside the application server in encrypted storage with restricted access.
- Configure retention and scheduled backups in the hosting platform; the application does not delete old archives automatically.
- Run a dry-run for every selected archive and perform a full restore drill in an isolated database regularly.
- Use compatible MongoDB source and destination versions during restore.

## WhatsApp QR API

```http
POST /api/whatsapp/connect
GET /api/whatsapp/qr
GET /api/whatsapp/status
POST /api/whatsapp/disconnect
Authorization: Bearer <jwt>
```

Socket.IO clients can connect to `/whatsapp-ws`, emit `watch-host` with `{ "hostId": "..." }`, and listen for `whatsapp-status`.

## Multi-Host WhatsApp

The backend keeps one `whatsapp-web.js` client per `hostId` in memory and stores each session independently through `RemoteAuth`.
This supports multiple different host WhatsApp connections on one backend instance.

For horizontal scaling with multiple backend instances, add distributed locking/shared state so only one instance owns a given `hostId` client.
