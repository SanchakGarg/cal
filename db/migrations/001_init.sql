-- Core schema for the appointment app. Mirrors cal.com's shape closely enough
-- that API responses can follow the cal.com API v2 contract.

CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  uid                   TEXT NOT NULL UNIQUE,
  username              TEXT NOT NULL UNIQUE,
  email                 TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL DEFAULT '',
  avatar_url            TEXT,
  bio                   TEXT,
  time_zone             TEXT NOT NULL DEFAULT 'Europe/London',
  week_start            TEXT NOT NULL DEFAULT 'Monday',
  time_format           SMALLINT NOT NULL DEFAULT 12,
  locale                TEXT NOT NULL DEFAULT 'en',
  default_schedule_id   INTEGER,
  is_guest              BOOLEAN NOT NULL DEFAULT FALSE,
  oidc_subject          TEXT UNIQUE,
  organization_id       INTEGER,
  completed_onboarding  BOOLEAN NOT NULL DEFAULT FALSE,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- Organizations are teams with is_organization = true; teams belonging to an
-- organization carry parent_id, exactly like cal.com.
CREATE TABLE teams (
  id                       SERIAL PRIMARY KEY,
  name                     TEXT NOT NULL,
  slug                     TEXT,
  parent_id                INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  is_organization          BOOLEAN NOT NULL DEFAULT FALSE,
  bio                      TEXT,
  logo_url                 TEXT,
  banner_url               TEXT,
  brand_color              TEXT,
  dark_brand_color         TEXT,
  theme                    TEXT,
  time_zone                TEXT NOT NULL DEFAULT 'Europe/London',
  week_start               TEXT NOT NULL DEFAULT 'Monday',
  time_format              SMALLINT NOT NULL DEFAULT 12,
  is_private               BOOLEAN NOT NULL DEFAULT FALSE,
  hide_branding            BOOLEAN NOT NULL DEFAULT FALSE,
  hide_book_a_team_member  BOOLEAN NOT NULL DEFAULT FALSE,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A slug is unique inside its parent (and unique globally for top level rows).
CREATE UNIQUE INDEX teams_slug_parent_idx ON teams (slug, parent_id) WHERE slug IS NOT NULL AND parent_id IS NOT NULL;
CREATE UNIQUE INDEX teams_slug_root_idx ON teams (slug) WHERE slug IS NOT NULL AND parent_id IS NULL;

ALTER TABLE users ADD CONSTRAINT users_organization_fk
  FOREIGN KEY (organization_id) REFERENCES teams(id) ON DELETE SET NULL;

CREATE TABLE memberships (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id               INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  accepted              BOOLEAN NOT NULL DEFAULT FALSE,
  disable_impersonation BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, team_id)
);
CREATE INDEX memberships_team_idx ON memberships (team_id);

CREATE TABLE team_invites (
  id          SERIAL PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX team_invites_team_idx ON team_invites (team_id);

CREATE TABLE schedules (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  time_zone  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX schedules_user_idx ON schedules (user_id);

ALTER TABLE users ADD CONSTRAINT users_default_schedule_fk
  FOREIGN KEY (default_schedule_id) REFERENCES schedules(id) ON DELETE SET NULL;

-- Weekly recurring availability. day: 0 = Sunday .. 6 = Saturday.
-- Multiple rows per (schedule, day) express multiple ranges in that day.
CREATE TABLE availability (
  id          SERIAL PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  day         SMALLINT NOT NULL CHECK (day BETWEEN 0 AND 6),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL
);
CREATE INDEX availability_schedule_idx ON availability (schedule_id);

-- Per-date overrides of the weekly availability.
-- start_time/end_time NULL => that date is marked fully unavailable.
CREATE TABLE date_overrides (
  id          SERIAL PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  start_time  TIME,
  end_time    TIME
);
CREATE INDEX date_overrides_schedule_date_idx ON date_overrides (schedule_id, date);

CREATE TABLE out_of_office (
  id         SERIAL PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'unspecified'
             CHECK (reason IN ('unspecified', 'vacation', 'travel', 'sick', 'public_holiday')),
  notes      TEXT,
  to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX out_of_office_user_idx ON out_of_office (user_id, start_date, end_date);

CREATE TABLE event_types (
  id                                  SERIAL PRIMARY KEY,
  owner_id                            INTEGER REFERENCES users(id) ON DELETE CASCADE,
  team_id                             INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  parent_id                           INTEGER REFERENCES event_types(id) ON DELETE CASCADE,
  title                               TEXT NOT NULL,
  slug                                TEXT NOT NULL,
  description                         TEXT NOT NULL DEFAULT '',
  length_in_minutes                   INTEGER NOT NULL CHECK (length_in_minutes > 0),
  length_in_minutes_options           INTEGER[],
  schedule_id                         INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  slot_interval                       INTEGER,
  minimum_booking_notice              INTEGER NOT NULL DEFAULT 120,
  before_event_buffer                 INTEGER NOT NULL DEFAULT 0,
  after_event_buffer                  INTEGER NOT NULL DEFAULT 0,
  offset_start                        INTEGER NOT NULL DEFAULT 0,
  hidden                              BOOLEAN NOT NULL DEFAULT FALSE,
  disable_guests                      BOOLEAN NOT NULL DEFAULT FALSE,
  requires_booker_email_verification  BOOLEAN NOT NULL DEFAULT FALSE,
  lock_timezone_toggle                BOOLEAN NOT NULL DEFAULT FALSE,
  only_show_first_available_slot      BOOLEAN NOT NULL DEFAULT FALSE,
  hide_calendar_notes                 BOOLEAN NOT NULL DEFAULT FALSE,
  hide_calendar_event_details         BOOLEAN NOT NULL DEFAULT FALSE,
  hide_organizer_email                BOOLEAN NOT NULL DEFAULT FALSE,
  success_redirect_url                TEXT,
  custom_name                         TEXT,
  interface_language                  TEXT,
  allow_rescheduling_past_bookings    BOOLEAN NOT NULL DEFAULT FALSE,
  disable_cancelling                  BOOLEAN NOT NULL DEFAULT FALSE,
  disable_rescheduling                BOOLEAN NOT NULL DEFAULT FALSE,
  scheduling_type                     TEXT CHECK (scheduling_type IN ('collective', 'roundRobin', 'managed')),
  assign_all_team_members             BOOLEAN NOT NULL DEFAULT FALSE,
  seats_per_time_slot                 INTEGER,
  seats_show_attendee_info            BOOLEAN NOT NULL DEFAULT FALSE,
  seats_show_availability_count       BOOLEAN NOT NULL DEFAULT TRUE,
  locations                           JSONB NOT NULL DEFAULT '[]'::jsonb,
  booking_fields                      JSONB NOT NULL DEFAULT '[]'::jsonb,
  booking_limits_count                JSONB,
  booking_limits_duration             JSONB,
  booker_active_bookings_limit        JSONB,
  booking_window                      JSONB,
  booker_layouts                      JSONB,
  confirmation_policy                 JSONB,
  recurrence                          JSONB,
  color                               JSONB,
  email_settings                      JSONB,
  metadata                            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_id IS NOT NULL OR team_id IS NOT NULL)
);
CREATE UNIQUE INDEX event_types_owner_slug_idx ON event_types (owner_id, slug) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX event_types_team_slug_idx ON event_types (team_id, slug) WHERE team_id IS NOT NULL;

CREATE TABLE event_type_hosts (
  event_type_id INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mandatory     BOOLEAN NOT NULL DEFAULT FALSE,
  priority      TEXT NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('lowest', 'low', 'medium', 'high', 'highest')),
  weight        INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (event_type_id, user_id)
);

CREATE TABLE bookings (
  id                      SERIAL PRIMARY KEY,
  uid                     TEXT NOT NULL UNIQUE,
  event_type_id           INTEGER REFERENCES event_types(id) ON DELETE SET NULL,
  user_id                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  booked_by_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  start_time              TIMESTAMPTZ NOT NULL,
  end_time                TIMESTAMPTZ NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'accepted'
                          CHECK (status IN ('accepted', 'pending', 'cancelled', 'rejected')),
  location                TEXT NOT NULL DEFAULT '',
  meeting_url             TEXT,
  cancellation_reason     TEXT,
  cancelled_by_email      TEXT,
  rescheduling_reason     TEXT,
  rescheduled_by_email    TEXT,
  rescheduled_from_uid    TEXT,
  rescheduled_to_uid      TEXT,
  recurring_event_uid     TEXT,
  absent_host             BOOLEAN NOT NULL DEFAULT FALSE,
  ics_uid                 TEXT,
  rating                  INTEGER,
  booking_fields_responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bookings_user_start_idx ON bookings (user_id, start_time);
CREATE INDEX bookings_event_type_start_idx ON bookings (event_type_id, start_time);
CREATE INDEX bookings_recurring_idx ON bookings (recurring_event_uid);

CREATE TABLE booking_attendees (
  id           SERIAL PRIMARY KEY,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  time_zone    TEXT NOT NULL,
  language     TEXT NOT NULL DEFAULT 'en',
  phone_number TEXT,
  no_show      BOOLEAN NOT NULL DEFAULT FALSE,
  seat_uid     TEXT UNIQUE,
  is_guest     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX booking_attendees_booking_idx ON booking_attendees (booking_id);

CREATE TABLE booking_hosts (
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mandatory  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (booking_id, user_id)
);

CREATE TABLE slot_reservations (
  uid           TEXT PRIMARY KEY,
  event_type_id INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  slot_start    TIMESTAMPTZ NOT NULL,
  slot_duration INTEGER NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  reserved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX slot_reservations_event_type_idx ON slot_reservations (event_type_id, slot_start);

CREATE TABLE private_links (
  id              SERIAL PRIMARY KEY,
  link_id         TEXT NOT NULL UNIQUE,
  event_type_id   INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ,
  max_usage_count INTEGER,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX private_links_event_type_idx ON private_links (event_type_id);

CREATE TABLE webhooks (
  id               SERIAL PRIMARY KEY,
  uid              TEXT NOT NULL UNIQUE,
  user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
  team_id          INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  event_type_id    INTEGER REFERENCES event_types(id) ON DELETE CASCADE,
  subscriber_url   TEXT NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  triggers         TEXT[] NOT NULL DEFAULT '{}',
  secret           TEXT,
  payload_template TEXT,
  time             INTEGER,
  time_unit        TEXT CHECK (time_unit IN ('DAY', 'HOUR', 'MINUTE')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE verified_emails (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE verified_phones (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  team_id      INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_verification_codes (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_codes_email_idx ON email_verification_codes (email);
