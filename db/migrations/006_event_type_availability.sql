-- Which of a host's own schedules apply to one event type.
--
-- Before this, an event type pointed at a single schedule and every host on it
-- was forced onto that one. Now each host picks their own, and may pick several,
-- in which case their hours are the union of them.
--
-- No rows for a host means "use my default availability", so existing event
-- types keep working untouched: the loader falls back to the event type's
-- schedule_id and then to the host's default schedule.

CREATE TABLE event_type_availability (
  event_type_id INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id   INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  PRIMARY KEY (event_type_id, user_id, schedule_id)
);

-- The loader reads every row for one event type at once.
CREATE INDEX event_type_availability_event_idx ON event_type_availability (event_type_id);
