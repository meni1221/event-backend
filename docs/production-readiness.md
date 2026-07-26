# Ishru Production Readiness

Last updated: 2026-07-26

This document is the release checklist for daily production use. A code change is complete only after tests, lint where available, and production builds pass on its feature branch before merge.

## Completed Foundation

- [x] Official Google OAuth for application sign-in and Google Contacts.
- [x] Default authentication for protected HTTP and WebSocket routes.
- [x] Database-backed account status, role, and session-version validation.
- [x] Session revocation after password changes, password resets, suspension, and restoration.
- [x] Owner-only host approval, suspension, and restoration controls.
- [x] Helmet, CORS allowlist, rate limits, proxy configuration, and production Swagger controls.
- [x] Startup validation for production environment variables and integration credentials.
- [x] MongoDB-backed tenant ownership filters for events and guests.
- [x] Globally unique public invitation identifiers.
- [x] Guest cleanup when an owned event is deleted.
- [x] Public invitation response allowlist that excludes private host and guest fields.
- [x] Liveness, readiness, and graceful shutdown support.
- [x] Guarded MongoDB archive backup and dry-run-first restore commands.
- [x] CI for backend tests, operational tests, lint, and build.
- [x] CI for frontend tests, TypeScript, and production build.
- [x] Frontend authentication accessibility checks and global render recovery.
- [x] Dependency audits reduced to zero known vulnerabilities as of the date above.

## Launch Blockers

These items require production infrastructure or account access and cannot be completed from source code alone.

- [ ] Revoke the exposed Google client secret and deploy a newly generated secret.
- [ ] Configure the final HTTPS frontend and backend domains.
- [ ] Register the exact authentication and Contacts redirect URIs in Google Cloud.
- [ ] Provision production MongoDB with restricted credentials, encryption, and automated backups.
- [ ] Schedule `npm run db:backup` or provider-native backups and complete a restore drill in an isolated database.
- [ ] Configure SMTP delivery and verify password reset and approval messages end to end.
- [ ] Configure SPF, DKIM, and DMARC for the sending domain.
- [ ] Configure log retention, error alerts, readiness alerts, and on-call notification routing.
- [ ] Verify persistent WhatsApp sessions survive a deployment restart.
- [ ] Ensure only one backend instance owns each WhatsApp connection before horizontal scaling.
- [ ] Run a production smoke test for sign-in, event creation, guest import, invitation, RSVP, email, and WhatsApp.

## Next Code Backlog

### P1: Release confidence

- [ ] Add HTTP integration tests with an isolated MongoDB test database.
- [ ] Test cross-tenant access through real controllers and guards, not only service filters.
- [ ] Add frontend linting and enforce it in CI.
- [ ] Add accessibility tests for guest RSVP, event editing, owner tables, and destructive dialogs.
- [ ] Add idempotency protection for message and email batch submissions.

### P1: Operations

- [ ] Add structured metrics for request latency, error rate, mail failures, and WhatsApp queue health.
- [ ] Add an operational retention policy for application logs and old guest data.
- [ ] Add a scheduled orphan-data audit for events, guests, and external connection records.
- [ ] Add distributed locking before running multiple WhatsApp backend replicas.

### P2: User lifecycle

- [ ] Add owner-assisted account data export.
- [ ] Add owner-assisted permanent host deletion with explicit confirmation and audit records.
- [ ] Add user-facing sign-in messaging for suspended accounts.
- [ ] Add support workflow documentation for account recovery and external integration failures.

## Release Gate

Run these commands before every production release:

```bash
# backend
npm audit --audit-level=moderate
npm test -- --runInBand
npm run test:ops
npm run lint
npm run build

# frontend
npm audit --audit-level=moderate
npm test
npm run build
```

Do not release when any command fails. After deployment, verify `/api/health/live` and `/api/health/ready` before directing user traffic to the new backend instance.
