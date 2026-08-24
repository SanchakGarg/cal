# Cal — self-hosted appointment scheduling

A cal.com-style scheduling app. Users publish event types, bookers pick a slot from
generated availability, and organizations/teams host collective or round-robin events.

- **API**: Node + TypeScript + Express + raw SQL over `pg` (no ORM). Endpoint shapes follow
  the [cal.com API v2 contract](https://cal.com/docs/api-reference/v2) — the downloaded spec
  lives in `docs/calspec.json`.
- **Web**: React + Vite. No UI kit, no CSS framework, no date library — every widget in
  `web/src/ui` is hand-built, styled with the design tokens in `web/src/styles/tokens.css`.
- **Auth**: Zitadel OIDC (hosted elsewhere, configured by env) plus a guest login for local
  testing. Each is switched on independently by env var.

## Requirements

- Node 22+ (uses `node --experimental-strip-types`, so TypeScript runs without a build step)
- Docker (for Postgres 16) — or any reachable Postgres via `DATABASE_URL`

## Setup

```bash
cp .env.example .env         # then edit the OIDC section for your Zitadel instance
npm install
npm run db:up                # docker compose up -d postgres
npm run db:migrate           # applies db/migrations/*.sql
npm run db:seed              # demo users, team, bookings (safe to re-run)
npm run dev                  # API on :3001, web on :5173
```

If the Docker daemon is not running: `sudo systemctl start docker`.

Then open <http://localhost:5173> and press **Continue as guest** — no provider setup needed.
See [DEPLOY.md](DEPLOY.md) for a step-by-step guest walkthrough, API curl examples, and
self-hosting (single container, Zitadel wiring, reverse proxy).

Seeded logins (guest login accepts any of these emails):

| email | availability |
|---|---|
| `alice@example.com` | Mon–Fri 09:00–17:00 Asia/Kolkata, plus a date override next Monday |
| `bob@example.com` | Mon–Fri 13:00–18:00 and Sat 10:00–14:00 Europe/London |

The seed also creates the `Acme Inc` organization, its `Sales` team, a collective
`Product Demo` event and a round-robin `Sales Intro` event.

## Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `API_PORT`, `API_ORIGIN`, `WEB_ORIGIN` | ports and CORS/redirect origins |
| `JWT_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` | our own access/refresh tokens |
| `AUTH_OIDC_ENABLED` | turns the Zitadel button and `/v2/auth/oidc/*` on or off |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_SCOPES` | Zitadel app settings. Leave the secret empty for a public (PKCE-only) client |
| `AUTH_GUEST_ENABLED`, `GUEST_AUTO_CREATE` | guest login for local testing |
| `SERVE_WEB` | serve the built web bundle from the API process (single-container hosting) |

Register `http://localhost:3001/v2/auth/oidc/callback` as the redirect URI in Zitadel.

## Features

**Availability** — weekly hours per schedule, several ranges per day, copy-times-to,
per-date overrides (different hours, or block the date entirely), out-of-office spans,
timezone per schedule, and a troubleshoot view showing the slots actually produced.

**Event types** — duration and multiple durations, locations, booking questions,
buffers, minimum notice, slot intervals, offset start, booking-frequency and total-duration
limits, future-booking window, requires-confirmation, seats, recurring events, private links,
hidden events, custom calendar event name, redirect on booking.

**Bookings** — slot reservation while the form is filled in, create/cancel/reschedule,
request-reschedule, confirm/decline, mark absent, reassign (round robin), guests, seated
bookings, ICS and Google/Outlook calendar links, outbound webhooks.

**Organizations and teams** — organizations own teams, members are added or invited,
roles OWNER/ADMIN/MEMBER, team event types with `collective` (intersection of hosts),
`roundRobin` (union, least-recently-booked host wins) or `managed` scheduling, plus
org-admin views of member schedules and out-of-office.

## Layout

```
db/migrations/          SQL schema
server/src/lib/         tz.ts, interval.ts, slots.ts  <- slot generation engine
server/src/modules/     one folder per API group (routes + repo)
server/src/auth/        jwt, oidc (Zitadel), guest, middleware
web/src/ui/             hand-built widget library
web/src/pages/          one file per screen
web/src/app/            router, shell, auth context, theme
```

## Tests

```bash
npm test    # server: timezone math, interval algebra, slot generation
```

The slot tests cover weekly availability, overrides (including "unavailable"), out of
office, buffers, minimum notice, booking windows, frequency and duration limits, seats,
collective intersection, round-robin union, and DST boundaries.
