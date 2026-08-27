-- Google sign-in and Google Calendar sync.
--
-- Google login and calendar linking are deliberately independent: a deployment
-- can turn sign-in off and still let people connect a calendar, so the account
-- identity (users.google_subject) and the calendar grant (calendar_connections)
-- live in separate places.

ALTER TABLE users ADD COLUMN google_subject TEXT UNIQUE;

CREATE TABLE calendar_connections (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  account_email     TEXT NOT NULL,
  account_subject   TEXT,
  access_token      TEXT,
  refresh_token     TEXT,
  token_expires_at  TIMESTAMPTZ,
  scopes            TEXT[] NOT NULL DEFAULT '{}',
  -- Which calendar new bookings are written to. 'primary' is Google's alias
  -- for the account's own calendar.
  calendar_id       TEXT NOT NULL DEFAULT 'primary',
  calendar_name     TEXT,
  -- Push bookings out to Google.
  sync_bookings     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Pull busy time back in so external events block slots.
  check_conflicts   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Set when a refresh fails so the UI can ask for a re-connect.
  invalid_since     TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, account_email)
);
CREATE INDEX calendar_connections_user_idx ON calendar_connections (user_id);

-- One row per (booking, connection): the external event we created for a host.
CREATE TABLE booking_calendar_events (
  id            SERIAL PRIMARY KEY,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  calendar_id   TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  html_link     TEXT,
  meeting_url   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, connection_id)
);
CREATE INDEX booking_calendar_events_booking_idx ON booking_calendar_events (booking_id);
