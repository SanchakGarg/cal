# Cal — self-hosted appointment scheduling

A cal.com-style scheduling app. Users publish event types, bookers pick a slot from
generated availability, and organizations/teams host collective or round-robin events.

- **API**: Node + TypeScript + Express + raw SQL over `pg` (no ORM). Endpoint shapes follow
  the [cal.com API v2 contract](https://cal.com/docs/api-reference/v2) — the downloaded spec
  lives in `docs/calspec.json`.
- **Web**: React + Vite. No UI kit, no CSS framework, no date library — every widget in
  `web/src/ui` is hand-built, styled with the design tokens in `web/src/styles/tokens.css`.
- **Auth**: Google sign-in, Zitadel OIDC (hosted elsewhere, configured by env) and a guest
  login for local testing. Each is switched on independently by env var.
- **Google Calendar**: optional two-way link — confirmed bookings are written to the host's
  calendar, and events already on it block their availability. Configured separately from
  Google sign-in, so it works whichever way people log in.

## Requirements

- Docker + Docker Compose (works the same in WSL — with Docker Desktop enable
  Settings → Resources → WSL integration, or inside WSL run `sudo service docker start`)
- For the hot-reload option only: Node 22+ (the API runs TypeScript directly via
  `node --experimental-strip-types`, so there is no build step for the server)

## Run it with Docker (recommended)

One container serves the API and the built web app on port 3001; Postgres runs beside it.

```bash
git clone https://github.com/SanchakGarg/cal.git
cd cal
cp .env.example .env

sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgres://cal:cal@postgres:5432/cal|' .env
sed -i 's|^SERVE_WEB=.*|SERVE_WEB=true|' .env
sed -i 's|^API_ORIGIN=.*|API_ORIGIN=http://localhost:3001|' .env
sed -i 's|^WEB_ORIGIN=.*|WEB_ORIGIN=http://localhost:3001|' .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48)|" .env

docker compose up -d --build
```

The container applies migrations before it serves, so that one command is enough.
Add demo users, a team and a booking with `SEED_ON_START=true docker compose up -d`.

Open <http://localhost:3001> and press **Continue as guest** — no identity provider needed.

`DATABASE_URL` must use the host `postgres` (the compose service name), not `localhost`:
inside the container `localhost` is the container itself. The `db:up` / `db:migrate` npm
scripts assume `localhost` instead, so they are for the hot-reload setup below.

Day to day:

```bash
docker compose logs -f app     # follow logs
docker compose restart app     # pick up .env changes
docker compose down            # stop (add -v to also wipe the database)
docker compose up -d --build   # rebuild after pulling new code
```

## Run it with hot reload (Postgres in Docker, app on the host)

Web on :5173 with Vite HMR, API on :3001.

```bash
cp .env.example .env      # defaults already point at localhost:5432, guest login on
npm install
npm run db:up             # docker compose up -d postgres
npm run db:migrate        # applies db/migrations/*.sql
npm run db:seed           # demo users, team, bookings (safe to re-run)
npm run dev               # API :3001, web :5173
```

Open <http://localhost:5173>. If the Docker daemon is not running:
`sudo systemctl start docker` (or `sudo service docker start` in WSL).

## Run it without Docker

Any reachable Postgres 16 works — install it locally and point `DATABASE_URL` at it:

```bash
sudo apt install -y postgresql && sudo service postgresql start
sudo -u postgres psql -c "CREATE USER cal WITH PASSWORD 'cal';"
sudo -u postgres psql -c "CREATE DATABASE cal OWNER cal;"

cp .env.example .env      # DATABASE_URL default already matches
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

To serve the production bundle from the API instead of Vite:

```bash
npm run build -w web
SERVE_WEB=true npm run start -w server      # everything on :3001
```

## Testing as a guest

Guest login is on by default (`AUTH_GUEST_ENABLED=true`), so you can exercise the whole
product without configuring Zitadel. Type any name, leave the email empty, and you get a
throwaway account with a Mon–Fri 09:00–17:00 schedule and two starter event types.

Guest login proves nothing about who is calling, so it only ever resumes *guest* accounts:
supplying the email of a real (OIDC) user is refused rather than logging you in as them.
Turn it off with `AUTH_GUEST_ENABLED=false` outside local use.

Seeded accounts — these are guest accounts, so entering one of these emails on the guest
form signs you in as that user:

| email | availability |
|---|---|
| `alice@example.com` | Mon–Fri 09:00–17:00 Asia/Kolkata, plus a date override next Monday |
| `bob@example.com` | Mon–Fri 13:00–18:00 and Sat 10:00–14:00 Europe/London |

The seed also creates the `Acme Inc` organization, its `Sales` team, a collective
`Product Demo` event and a round-robin `Sales Intro` event.

[DEPLOY.md](DEPLOY.md) has a step-by-step walkthrough of every feature, `curl` examples
against the API, TLS/reverse-proxy setup and the Zitadel wiring.

## Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `API_PORT`, `API_ORIGIN`, `WEB_ORIGIN` | ports and CORS/redirect origins |
| `JWT_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` | our own access/refresh tokens |
| `AUTH_OIDC_ENABLED` | turns the Zitadel button and `/v2/auth/oidc/*` on or off |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_SCOPES` | Zitadel app settings. Leave the secret empty for a public (PKCE-only) client |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | one Google Cloud OAuth client, shared by sign-in and calendar linking |
| `AUTH_GOOGLE_ENABLED` | turns the "Continue with Google" button and `/v2/auth/google/*` on or off |
| `GOOGLE_CALENDAR_ENABLED` | turns calendar linking (Settings → Calendars, `/v2/calendars/*`) on or off, independently of the login button |
| `GOOGLE_CREATE_MEET_LINKS` | ask Google for a Meet link on synced events that have no location of their own |
| `AUTH_GUEST_ENABLED`, `GUEST_AUTO_CREATE` | guest login for local testing |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | SMTP transport. Leave `SMTP_HOST` empty to run without mail — messages are logged instead of sent |
| `MAIL_FROM` | `From` header on outgoing mail, e.g. `Cal <no-reply@example.com>` |
| `EXPOSE_VERIFICATION_CODES` | returns booker email codes in the API response — local only, it defeats the check |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | allows webhook URLs pointing at private/loopback addresses |
| `NODE_ENV` | `production` returns generic 5xx bodies and requires an explicit `JWT_SECRET` |
| `SERVE_WEB` | serve the built web bundle from the API process (single-container hosting) |

Register `http://localhost:3001/v2/auth/oidc/callback` as the redirect URI in Zitadel.

### Google setup

In [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0 Client ID
of type *Web application* and:

1. add `http://localhost:3001/v2/auth/google/callback` (your `API_ORIGIN` in production) as
   an **Authorized redirect URI** — sign-in and calendar linking both come back to it;
2. add `http://localhost:5173` (your `WEB_ORIGIN`) as an **Authorized JavaScript origin**;
3. for calendar linking, enable the **Google Calendar API** on the project and add the
   `calendar.events` and `calendar.readonly` scopes to the consent screen.

Then set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and switch on whichever of
`AUTH_GOOGLE_ENABLED` and `GOOGLE_CALENDAR_ENABLED` you want. They are independent: a
deployment can hide the Google login button and still offer calendar linking under
Settings → Calendars.

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

**Calendar view** — `/calendar` shows every booking you can see in day, week or month form,
filtered to your own bookings or any team you belong to, with cancelled bookings hidden by
default. Clicking an event opens its booking page; clicking a month cell drills into that day.

**Google Calendar sync** — each user can link one or more Google accounts under
Settings → Calendars, pick which calendar bookings are written to, and toggle the two
directions separately: *add confirmed bookings to this calendar* and *block my availability
with events from this calendar*. Confirming, cancelling, rescheduling and reassigning a
booking all update the Google event; a booking awaiting confirmation is only written once it
is confirmed. Every sync is best effort — Google being unreachable never fails a booking, and
a grant Google stops honouring is flagged on the settings page for reconnection.

**Organizations and teams** — organizations own teams, members are added or invited,
roles OWNER/ADMIN/MEMBER, team event types with `collective` (intersection of hosts),
`roundRobin` (union, least-recently-booked host wins) or `managed` scheduling, plus
org-admin views of member schedules and out-of-office. Every team also gets one public
page at `/team/<slug>` listing all of its bookable events; unless the team turns
*Book a team member* off, that page also lets a visitor pick any accepted member and book
that person's own event types directly.

## Layout

```
db/migrations/          SQL schema
server/src/lib/         tz.ts, interval.ts, slots.ts  <- slot generation engine
server/src/modules/     one folder per API group (routes + repo)
server/src/auth/        jwt, oidc (Zitadel), google, guest, middleware
server/src/lib/google.ts, calendar-sync.ts   Google OAuth + Calendar API, booking mirror
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
