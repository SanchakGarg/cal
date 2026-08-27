-- The app's default timezone is Asia/Kolkata. This changes the column defaults
-- only, for rows created without an explicit zone. Existing users, teams and
-- schedules keep whatever they already have: rewriting them would silently move
-- people's working hours.

ALTER TABLE users ALTER COLUMN time_zone SET DEFAULT 'Asia/Kolkata';
ALTER TABLE teams ALTER COLUMN time_zone SET DEFAULT 'Asia/Kolkata';
