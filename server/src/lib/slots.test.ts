import assert from "node:assert/strict";
import { test } from "node:test";
import { type HostSchedule, generateSlots, groupSlotsByDate, isSlotBookable } from "./slots.ts";

const MON_TO_FRI = [1, 2, 3, 4, 5];

function host(overrides: Partial<HostSchedule> = {}): HostSchedule {
  return {
    userId: 1,
    timeZone: "UTC",
    weekly: MON_TO_FRI.map((day) => ({ day, startTime: "09:00", endTime: "17:00" })),
    overrides: [],
    ooo: [],
    busy: [],
    ...overrides,
  };
}

const ms = (iso: string): number => new Date(iso).getTime();
// 2026-08-24 is a Monday, 2026-08-29 a Saturday.
const MONDAY = "2026-08-24";
const now = ms("2026-08-20T00:00:00Z");

function starts(slots: { start: number }[]): string[] {
  return slots.map((slot) => new Date(slot.start).toISOString());
}

test("generates slots across weekly availability, honouring duration", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms(`${MONDAY}T23:59:00Z`),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    now,
  });
  assert.equal(slots.length, 8);
  assert.equal(new Date(slots[0].start).toISOString(), `${MONDAY}T09:00:00.000Z`);
  assert.equal(new Date(slots[7].start).toISOString(), `${MONDAY}T16:00:00.000Z`);
});

test("skips days with no weekly availability", () => {
  const slots = generateSlots([host()], {
    from: ms("2026-08-29T00:00:00Z"),
    to: ms("2026-08-30T23:59:00Z"),
    durationMinutes: 30,
    minimumBookingNotice: 0,
    now,
  });
  assert.equal(slots.length, 0);
});

test("slotInterval decouples the grid from the duration", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms(`${MONDAY}T23:59:00Z`),
    durationMinutes: 60,
    slotIntervalMinutes: 30,
    minimumBookingNotice: 0,
    now,
  });
  assert.equal(slots.length, 15);
  assert.equal(new Date(slots[1].start).toISOString(), `${MONDAY}T09:30:00.000Z`);
});

test("a date override replaces the weekly hours for that date only", () => {
  const slots = generateSlots(
    [host({ overrides: [{ date: MONDAY, startTime: "13:00", endTime: "15:00" }] })],
    {
      from: ms(`${MONDAY}T00:00:00Z`),
      to: ms("2026-08-25T23:59:00Z"),
      durationMinutes: 60,
      minimumBookingNotice: 0,
      now,
    }
  );
  const grouped = groupSlotsByDate(slots, "UTC");
  assert.deepEqual(starts(grouped[MONDAY]), [
    `${MONDAY}T13:00:00.000Z`,
    `${MONDAY}T14:00:00.000Z`,
  ]);
  assert.equal(grouped["2026-08-25"].length, 8);
});

test("an override with null times marks the date unavailable", () => {
  const slots = generateSlots(
    [host({ overrides: [{ date: MONDAY, startTime: null, endTime: null }] })],
    {
      from: ms(`${MONDAY}T00:00:00Z`),
      to: ms("2026-08-25T23:59:00Z"),
      durationMinutes: 60,
      minimumBookingNotice: 0,
      now,
    }
  );
  const grouped = groupSlotsByDate(slots, "UTC");
  assert.equal(grouped[MONDAY], undefined);
  assert.equal(grouped["2026-08-25"].length, 8);
});

test("out of office removes whole dates", () => {
  const slots = generateSlots(
    [host({ ooo: [{ startDate: MONDAY, endDate: "2026-08-25" }] })],
    {
      from: ms(`${MONDAY}T00:00:00Z`),
      to: ms("2026-08-26T23:59:00Z"),
      durationMinutes: 60,
      minimumBookingNotice: 0,
      now,
    }
  );
  const dates = Object.keys(groupSlotsByDate(slots, "UTC"));
  assert.deepEqual(dates, ["2026-08-26"]);
});

test("existing busy time plus buffers removes overlapping slots", () => {
  const slots = generateSlots(
    [
      host({
        // 11:00-12:00 booking widened by a 30 minute buffer on each side.
        busy: [{ start: ms(`${MONDAY}T10:30:00Z`), end: ms(`${MONDAY}T12:30:00Z`) }],
      }),
    ],
    {
      from: ms(`${MONDAY}T00:00:00Z`),
      to: ms(`${MONDAY}T23:59:00Z`),
      durationMinutes: 60,
      minimumBookingNotice: 0,
      now,
    }
  );
  assert.deepEqual(starts(slots), [
    `${MONDAY}T09:00:00.000Z`,
    `${MONDAY}T12:30:00.000Z`,
    `${MONDAY}T13:30:00.000Z`,
    `${MONDAY}T14:30:00.000Z`,
    `${MONDAY}T15:30:00.000Z`,
  ]);
});

test("minimum booking notice trims the near future", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms(`${MONDAY}T23:59:00Z`),
    durationMinutes: 60,
    minimumBookingNotice: 240,
    now: ms(`${MONDAY}T09:00:00Z`),
  });
  assert.equal(new Date(slots[0].start).toISOString(), `${MONDAY}T13:00:00.000Z`);
});

test("booking window limits how far ahead slots go", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms("2026-09-30T00:00:00Z"),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    bookingWindow: { type: "calendarDays", value: 2, rolling: true },
    now: ms(`${MONDAY}T08:00:00Z`),
  });
  const dates = Object.keys(groupSlotsByDate(slots, "UTC"));
  assert.deepEqual(dates, [MONDAY, "2026-08-25", "2026-08-26"]);
});

test("booking limits cap slots per period", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms("2026-08-25T23:59:00Z"),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    bookingLimitsCount: { day: 2 },
    eventTypeBookings: [
      { start: ms(`${MONDAY}T09:00:00Z`), end: ms(`${MONDAY}T10:00:00Z`) },
      { start: ms(`${MONDAY}T10:00:00Z`), end: ms(`${MONDAY}T11:00:00Z`) },
    ],
    limitsTimeZone: "UTC",
    now,
  });
  const grouped = groupSlotsByDate(slots, "UTC");
  assert.equal(grouped[MONDAY], undefined);
  assert.equal(grouped["2026-08-25"].length, 8);
});

test("duration limits cap total booked minutes per period", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms(`${MONDAY}T23:59:00Z`),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    bookingLimitsDuration: { day: 90 },
    eventTypeBookings: [{ start: ms(`${MONDAY}T09:00:00Z`), end: ms(`${MONDAY}T10:00:00Z`) }],
    limitsTimeZone: "UTC",
    now,
  });
  assert.equal(slots.length, 0);
});

test("onlyShowFirstAvailableSlot keeps one slot per date", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms("2026-08-25T23:59:00Z"),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    onlyShowFirstAvailableSlot: true,
    now,
  });
  assert.deepEqual(starts(slots), [`${MONDAY}T09:00:00.000Z`, "2026-08-25T09:00:00.000Z"]);
});

test("collective events intersect host availability", () => {
  const alice = host({ userId: 1 });
  const bob = host({
    userId: 2,
    weekly: MON_TO_FRI.map((day) => ({ day, startTime: "13:00", endTime: "18:00" })),
  });
  const slots = generateSlots([alice, bob], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms(`${MONDAY}T23:59:00Z`),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    schedulingType: "collective",
    now,
  });
  assert.deepEqual(starts(slots), [
    `${MONDAY}T13:00:00.000Z`,
    `${MONDAY}T14:00:00.000Z`,
    `${MONDAY}T15:00:00.000Z`,
    `${MONDAY}T16:00:00.000Z`,
  ]);
  assert.deepEqual(slots[0].hostIds, [1, 2]);
});

test("round robin events union host availability and report candidates", () => {
  const alice = host({ userId: 1 });
  const bob = host({
    userId: 2,
    weekly: MON_TO_FRI.map((day) => ({ day, startTime: "17:00", endTime: "19:00" })),
  });
  const slots = generateSlots([alice, bob], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms("2026-08-25T00:00:00Z"),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    schedulingType: "roundRobin",
    now,
  });
  assert.equal(slots.length, 10);
  assert.deepEqual(slots[0].hostIds, [1]);
  assert.deepEqual(slots.at(-1)?.hostIds, [2]);
});

test("seated events keep the slot and report remaining seats", () => {
  const slots = generateSlots([host()], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms(`${MONDAY}T12:00:00Z`),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    seatsPerTimeSlot: 3,
    bookedSeats: new Map([
      [`${MONDAY}T09:00:00.000Z`, 1],
      [`${MONDAY}T10:00:00.000Z`, 3],
    ]),
    now,
  });
  assert.deepEqual(starts(slots), [
    `${MONDAY}T09:00:00.000Z`,
    `${MONDAY}T11:00:00.000Z`,
  ]);
  assert.equal(slots[0].seatsRemaining, 2);
});

test("slots follow the schedule timezone across DST", () => {
  const nyHost = host({ timeZone: "America/New_York" });
  const summer = generateSlots([nyHost], {
    from: ms(`${MONDAY}T00:00:00Z`),
    to: ms("2026-08-25T00:00:00Z"),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    now,
  });
  assert.equal(new Date(summer[0].start).toISOString(), `${MONDAY}T13:00:00.000Z`);

  const winter = generateSlots([nyHost], {
    from: ms("2026-01-05T00:00:00Z"),
    to: ms("2026-01-06T00:00:00Z"),
    durationMinutes: 60,
    minimumBookingNotice: 0,
    now: ms("2026-01-01T00:00:00Z"),
  });
  assert.equal(new Date(winter[0].start).toISOString(), "2026-01-05T14:00:00.000Z");
});

test("isSlotBookable validates a single instant", () => {
  const options = {
    from: 0,
    to: 0,
    durationMinutes: 60,
    minimumBookingNotice: 0,
    now,
  };
  assert.ok(isSlotBookable([host()], ms(`${MONDAY}T09:00:00Z`), options));
  assert.equal(isSlotBookable([host()], ms(`${MONDAY}T08:00:00Z`), options), null);
  assert.equal(isSlotBookable([host()], ms(`${MONDAY}T09:15:00Z`), options), null);
});
