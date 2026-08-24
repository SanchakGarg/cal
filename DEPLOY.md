# Hosting and testing

Two ways to run this: **local dev** (two processes, hot reload) and **self-hosted**
(one container serving the API and the built web app). Both need Postgres.

Guest login exists so you can test everything without configuring Zitadel.

---

## 1. Quick test as a guest (local, ~2 minutes)

```bash
git clone https://github.com/SanchakGarg/cal.git
cd cal
cp .env.example .env          # defaults are fine: guest login on, OIDC off
npm install

sudo systemctl start docker   # if the daemon is not running
npm run db:up                 # postgres:16 on localhost:5432
npm run db:migrate            # create the schema
npm run db:seed               # demo users, team, a booking

npm run dev                   # API :3001, web :5173
```

Open <http://localhost:5173>. The login page shows **Continue as guest** (because
`AUTH_GUEST_ENABLED=true`).

### Walk through the whole product

1. **Sign in** — type any name, leave email empty, press *Continue as guest*. A throwaway
   account is created with a Mon–Fri 09:00–17:00 schedule and two starter event types.
2. **Onboarding** — set your username, timezone, week start and weekly hours, then *Finish*.
3. **Availability** (`/availability`) — open the schedule. Toggle a day off, add a second
   time range to a day, use the copy icon to copy times to other days, then *Save*.
4. **Date override** — in the right rail choose *Add an override*, pick a date, set
   13:00–15:00 (or tick *Mark unavailable*) and save. This changes one date only, leaving the
   weekly hours intact.
5. **Out of office** — avatar menu → *Out of office* → *Add*, select a start and end date.
   Those days stop producing slots.
6. **Event type** — `/event-types` → *New*, e.g. "Intro call", 30 minutes. In the detail
   tabs try *Limits* (buffers, minimum notice, 2 bookings per day) and *Advanced*
   (a custom booking question, seats, requires confirmation).
7. **Book it** — copy the event link (copy icon) and open it in a private window.
   The calendar only offers dates your availability allows; the override date shows just
   13:00 and 14:00; out-of-office dates are gone. Book a slot.
8. **See the booking** — back in the app, `/bookings` → *Upcoming*. Cancel or reschedule it;
   after cancelling, the slot reappears on the public page.
9. **Troubleshoot** (`/availability/troubleshoot`) — the exact slots the API generates for
   any event type, day by day. Useful when a slot is missing and you want to know why.
10. **Teams** — `/teams` → *New team*, then *Add member* (use `bob@example.com`, seeded with
    13:00–18:00 London hours). Create a team event type and pick a scheduling type:
    * **Collective** — slots are the *intersection* of all hosts' availability.
    * **Round robin** — slots are the *union*; each booking goes to the least recently
      booked available host.
11. **Organizations** — *New organization* on the Teams page, then
    `/settings/organization/members` to add people, group them into teams and inspect each
    member's schedules.

Seeded accounts you can sign in as (guest login accepts a known email and reuses that user):

| email | availability |
|---|---|
| `alice@example.com` | Mon–Fri 09:00–17:00 Asia/Kolkata + a date override next Monday |
| `bob@example.com` | Mon–Fri 13:00–18:00 and Sat 10:00–14:00 Europe/London |

The seed also creates `Acme Inc` (organization), its `Sales` team, a collective
*Product Demo* event and a round-robin *Sales Intro* event.

### Test the API directly

```bash
# guest login -> tokens
TOKEN=$(curl -s -X POST localhost:3001/v2/auth/guest \
  -H 'content-type: application/json' -d '{"name":"Api Tester"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["accessToken"])')

# my profile, my schedules
curl -s localhost:3001/v2/me -H "authorization: Bearer $TOKEN"
curl -s localhost:3001/v2/schedules -H "authorization: Bearer $TOKEN"

# create an event type
curl -s -X POST localhost:3001/v2/event-types -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Intro call","slug":"intro","lengthInMinutes":30}'

# available slots (public, no token needed)
curl -s "localhost:3001/v2/slots?eventTypeId=1&start=2026-09-01T00:00:00Z&end=2026-09-08T00:00:00Z&timeZone=Europe/London"

# book one
curl -s -X POST localhost:3001/v2/bookings -H 'content-type: application/json' -d '{
  "start":"2026-09-01T09:00:00.000Z","eventTypeId":1,
  "attendee":{"name":"Dana","email":"dana@example.com","timeZone":"Europe/London"}}'
```

Turning guest login off (`AUTH_GUEST_ENABLED=false`) makes `POST /v2/auth/guest` return
`403` and removes the guest form from the login page. Same for `AUTH_OIDC_ENABLED` and the
SSO button — the login page renders whatever `GET /v2/auth/providers` reports.

---

## 2. Self-hosting (single container + Postgres)

```bash
cp .env.example .env
# edit .env: JWT_SECRET, API_ORIGIN, WEB_ORIGIN, SERVE_WEB=true, OIDC settings
docker compose --profile app up -d --build
docker compose exec app node --experimental-strip-types server/src/db/migrate.ts
# optional demo data:
docker compose exec app node --experimental-strip-types server/src/db/seed.ts
```

The app is then on <http://localhost:3001> — API under `/v2`, web app on every other path.

Minimal production `.env` behind a domain:

```dotenv
DATABASE_URL=postgres://cal:CHANGE_ME@postgres:5432/cal
API_PORT=3001
API_ORIGIN=https://cal.example.com
WEB_ORIGIN=https://cal.example.com
SERVE_WEB=true
JWT_SECRET=<openssl rand -base64 48>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d

AUTH_OIDC_ENABLED=true
OIDC_ISSUER=https://your-instance.zitadel.cloud
OIDC_CLIENT_ID=1234567890@cal
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=https://cal.example.com/v2/auth/oidc/callback
OIDC_SCOPES=openid profile email
OIDC_POST_LOGOUT_REDIRECT_URI=https://cal.example.com/auth/login

# keep guest login on only while you are still testing
AUTH_GUEST_ENABLED=false
GUEST_AUTO_CREATE=false
```

Because `API_ORIGIN` and `WEB_ORIGIN` are the same host with `SERVE_WEB=true`, no CORS
configuration is needed. Put any TLS terminator (Caddy, nginx, Traefik) in front and
forward everything to port 3001:

```caddyfile
cal.example.com {
    reverse_proxy localhost:3001
}
```

Also change the Postgres password in `docker-compose.yml` (and `DATABASE_URL`) before
exposing the stack, and keep port 5432 off the public interface.

### Running without Docker

```bash
npm install
npm run build -w web
DATABASE_URL=... npm run migrate -w server
SERVE_WEB=true npm run start -w server     # node --experimental-strip-types
```

Node 22+ is required — the server runs TypeScript directly, so there is no build step
for the API.

---

## 3. Connecting Zitadel

1. In the Zitadel console create a **Project**, then an **Application** of type *User Agent*
   (SPA) — or *Web* if you want a client secret.
2. Auth method: **PKCE** (leave `OIDC_CLIENT_SECRET` empty). For a Web app with
   *Basic* auth, put the secret in `OIDC_CLIENT_SECRET` instead.
3. Redirect URI: `https://cal.example.com/v2/auth/oidc/callback`
   (locally: `http://localhost:3001/v2/auth/oidc/callback`).
4. Post-logout URI: `https://cal.example.com/auth/login`.
5. Scopes `openid profile email` — the API also calls the userinfo endpoint when the
   id_token omits name/email.
6. Copy the client id into `OIDC_CLIENT_ID`, the instance URL into `OIDC_ISSUER`, and set
   `AUTH_OIDC_ENABLED=true`.

First sign-in creates the local user (matched by `sub`, falling back to email), gives them a
Mon–Fri 09:00–17:00 default schedule plus two starter event types, and sends them to
onboarding.

---

## 4. Operational notes

- **Migrations** are plain SQL in `db/migrations/`, applied in filename order and tracked in
  a `_migrations` table. Add new ones as `002_*.sql`; never edit an applied file.
- **Backups**: `docker compose exec postgres pg_dump -U cal cal > cal-$(date +%F).sql`.
- **Tests**: `npm test` runs the timezone, interval and slot-generation suites — worth running
  after touching anything under `server/src/lib/`.
- **Health check**: `GET /health` returns `{"status":"success","data":{"status":"up"}}`.
- **Webhooks** are dispatched fire-and-forget with an `x-cal-signature-256` HMAC header when
  the webhook has a secret.
