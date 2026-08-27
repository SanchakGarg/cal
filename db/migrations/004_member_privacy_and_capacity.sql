-- Two member-controlled opt-outs, plus the flag that decides whether a slot
-- publishes how much capacity is left.

-- A member can keep their own event types off the team's public page. Their
-- personal booking link still works; it just is not advertised by the team.
ALTER TABLE memberships
  ADD COLUMN hide_personal_events BOOLEAN NOT NULL DEFAULT FALSE;

-- A schedule can be marked personal-only. Team events — collective ones
-- included — will not draw availability from it, wherever the member is added
-- as a host.
ALTER TABLE schedules
  ADD COLUMN exclude_from_team BOOLEAN NOT NULL DEFAULT FALSE;
