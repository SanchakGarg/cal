import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDaysISO,
  datesBetween,
  startOfWeekISO,
  zonedDateISO,
  zonedTimeHHMM,
  zonedTimeToUtc,
  zoneOffsetMinutes,
} from "./tz.ts";

test("converts wall clock to UTC for a fixed-offset zone", () => {
  const instant = zonedTimeToUtc("2026-03-10", "09:00", "Asia/Kolkata");
  assert.equal(instant.toISOString(), "2026-03-10T03:30:00.000Z");
});

test("handles US spring-forward: 09:00 EDT is 13:00 UTC", () => {
  const before = zonedTimeToUtc("2026-03-07", "09:00", "America/New_York");
  const after = zonedTimeToUtc("2026-03-10", "09:00", "America/New_York");
  assert.equal(before.toISOString(), "2026-03-07T14:00:00.000Z");
  assert.equal(after.toISOString(), "2026-03-10T13:00:00.000Z");
});

test("handles US fall-back", () => {
  const before = zonedTimeToUtc("2026-10-30", "09:00", "America/New_York");
  const after = zonedTimeToUtc("2026-11-05", "09:00", "America/New_York");
  assert.equal(before.toISOString(), "2026-10-30T13:00:00.000Z");
  assert.equal(after.toISOString(), "2026-11-05T14:00:00.000Z");
});

test("handles southern-hemisphere DST", () => {
  const january = zonedTimeToUtc("2026-01-15", "09:00", "Australia/Sydney");
  const july = zonedTimeToUtc("2026-07-15", "09:00", "Australia/Sydney");
  assert.equal(january.toISOString(), "2026-01-14T22:00:00.000Z");
  assert.equal(july.toISOString(), "2026-07-14T23:00:00.000Z");
});

test("skipped local time (02:30 on spring-forward) resolves forward", () => {
  const instant = zonedTimeToUtc("2026-03-08", "02:30", "America/New_York");
  assert.equal(instant.toISOString(), "2026-03-08T07:30:00.000Z");
});

test("round trips instants back to zoned fields", () => {
  const instant = new Date("2026-08-24T03:30:00.000Z");
  assert.equal(zonedDateISO(instant, "Asia/Kolkata"), "2026-08-24");
  assert.equal(zonedTimeHHMM(instant, "Asia/Kolkata"), "09:00");
  assert.equal(zonedDateISO(instant, "America/Los_Angeles"), "2026-08-23");
  assert.equal(zonedTimeHHMM(instant, "America/Los_Angeles"), "20:30");
});

test("reports zone offsets in minutes east of UTC", () => {
  assert.equal(zoneOffsetMinutes(new Date("2026-08-24T00:00:00Z"), "Asia/Kolkata"), 330);
  assert.equal(zoneOffsetMinutes(new Date("2026-01-15T00:00:00Z"), "America/New_York"), -300);
  assert.equal(zoneOffsetMinutes(new Date("2026-07-15T00:00:00Z"), "America/New_York"), -240);
});

test("date helpers walk the calendar", () => {
  assert.equal(addDaysISO("2026-02-28", 1), "2026-03-01");
  assert.equal(addDaysISO("2024-02-28", 1), "2024-02-29");
  assert.deepEqual(
    datesBetween(new Date("2026-08-24T00:00:00Z"), new Date("2026-08-26T23:00:00Z"), "UTC"),
    ["2026-08-24", "2026-08-25", "2026-08-26"]
  );
  assert.equal(startOfWeekISO("2026-08-24", "Monday"), "2026-08-24");
  assert.equal(startOfWeekISO("2026-08-24", "Sunday"), "2026-08-23");
  assert.equal(startOfWeekISO("2026-08-30", "Monday"), "2026-08-24");
});
