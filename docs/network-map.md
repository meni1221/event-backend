# Ishru Network Map

All REST paths below are prefixed with `/api`. Protected routes require `Authorization: Bearer <JWT>` and are tenant-scoped unless marked owner-only.

## Browser to backend REST

| Area | Methods and paths | Access | Purpose |
| --- | --- | --- | --- |
| Authentication | `POST /auth/register`, `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/google`, `GET /auth/google/callback` | Public, rate limited | Account creation, sessions, recovery, Google sign-in |
| Admin profile | `GET/PATCH /admin/me/profile`, `PATCH /admin/me/onboarding`, `PATCH /admin/me/password`, `DELETE /admin/me` | Protected | Profile, onboarding, password and account deletion |
| Owner operations | `GET /admin/overview`, `PATCH /admin/:adminId/approve`, `PATCH /admin/:adminId/suspend`, `PATCH /admin/:adminId/restore` | Owner only | Host lifecycle management |
| Events | `GET/POST /events`, `PATCH/DELETE /events/:eventId` | Protected, tenant scoped | Event lifecycle and invitation drafts |
| Seating | `GET/PUT /events/:eventId/seating` | Protected, tenant scoped | Persisted table layout and guest assignments |
| Guests | `GET /guests`, `POST /guests/event/:eventId`, `PATCH/DELETE /guests/:guestId` | Protected, tenant scoped | Guest lifecycle |
| Public invitations | `GET /guests/invite/:inviteId`, `GET /guests/invite/:eventId/:inviteId`, matching `PATCH .../rsvp` routes | Public, rate limited | Invitation display and RSVP submission |
| Google Contacts | `GET /google/status`, `GET /google/connect`, `GET /google/contacts`, `POST /google/disconnect`, `GET /google/callback` | Protected except callback | OAuth connection and contact import |
| Email | `POST /mail/send-invitations` | Protected, rate limited | Invitation email batch |
| WhatsApp | `POST /whatsapp/connect`, `GET /whatsapp/qr`, `GET /whatsapp/status`, `POST /whatsapp/disconnect` | Protected | Connection lifecycle |
| WhatsApp queue | `POST /whatsapp/send-batch`, `POST /whatsapp/send-test`, `GET /whatsapp/send-state`, `GET /whatsapp/send-history`, `POST /whatsapp/send-stop`, `POST /whatsapp/send-pause`, `POST /whatsapp/send-resume`, `POST /whatsapp/send-retry-failed` | Protected, sending is rate limited | Message queue operation |
| Logs | `POST /logs/frontend`, `GET /logs` | Protected; search is owner-only | Structured client logs and operational search |
| Health | `GET /health/live`, `GET /health/ready` | Public | Process and dependency health |

## WebSocket

- Namespace: `/whatsapp-ws`.
- Authentication: JWT in Socket.IO `auth.token` or Bearer header.
- Client event: `watch-host` with optional `connectionId`.
- Server events: `whatsapp-status` and `whatsapp-queue`.
- Isolation: each socket joins a room derived from authenticated `hostId` and `connectionId`.

## Backend outbound connections

| Dependency | Protocol | Data and purpose |
| --- | --- | --- |
| MongoDB | MongoDB driver TLS in production | Admins, events, guests, logs, credentials and WhatsApp session archives |
| Google OAuth | HTTPS OAuth 2.0/OIDC | Application sign-in and Contacts authorization |
| Google People API | HTTPS | Contact names, email addresses and phone numbers |
| SMTP provider | SMTP with TLS | Password resets, approval notifications and invitation email batches |
| WhatsApp Web | HTTPS/WebSocket through `whatsapp-web.js` | Pairing, session restoration and message delivery |

## Frontend transport behavior

- Base URL: `VITE_API_BASE_URL`; production must include the `/api` prefix and HTTPS.
- Authenticated REST calls attach the active JWT and `x-request-id`.
- Public invite and RSVP calls intentionally omit authorization.
- A `401` response expires the local session and returns the user to authentication.
- Structured frontend failures are sent to `POST /logs/frontend` when a session exists.
- WhatsApp status uses initial REST snapshots followed by Socket.IO updates.

## Known network gaps before pilot

- Batch email and WhatsApp submissions do not yet accept idempotency keys.
- No request-level metrics endpoint or metrics exporter exists.
- WhatsApp ownership is process-local; multiple backend replicas require distributed locking.
- External dependency timeouts, retries and circuit-breaking are not consistently defined.
- There is no automated end-to-end smoke test covering all external providers.
- Production domains, OAuth redirects, SMTP authentication and monitoring destinations remain infrastructure configuration tasks.
