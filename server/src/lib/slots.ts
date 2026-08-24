// Slot generation. Pure functions: the caller loads data, this decides what is
// bookable. Shared by GET /v2/slots and POST /v2/bookings so both agree.

import {
  type Interval,
  contains,
  intersectAll,
  normalize,
  subtract,
  union,
} from "./interval.ts";
import {
  addDaysISO,
  datesBetween,
  startOfMonthISO,
  startOfWeekISO,
  startOfYearISO,
  toMinutes,
  weekdayOfDateISO,
  zonedDateISO,
  zonedTimeToUtc,
} from "./tz.ts";

export interface WeeklyAvailability {
  day: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface DateOverride {
  date: string; // YYYY-MM-DD
  startTime: string | null; // null on both ends => unavailable that date
  endTime: string | null;
}

export interface OooSpan {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
}

export interface HostSchedule {
  userId: number;
  timeZone: string;
  weekly: WeeklyAvailability[];
  overrides: DateOverride[];
  ooo: OooSpan[];
  /** Already-busy time for this host, buffers included, in epoch ms. */
  busy: Interval[];
}

export interface BookingLimits {
  day?: number;
  week?: number;
  month?: number;
  year?: number;
}

export interface BookingWindow {
  type: "businessDays" | "calendarDays" | "range";
  value?: number;
  rolling?: boolean;
  /** For `range`: inclusive ISO dates. */
  startDate?: string;
  endDate?: string;
}

export interface ExistingBooking {
  start: number;
  end: number;
}

export interface SlotOptions {
  /** Range requested by the client, in epoch ms. */
  from: number;
  to: number;
  durationMinutes: number;
  slotIntervalMinutes?: number | null;
  minimumBookingNotice?: number;
  offsetStartMinutes?: number;
  onlyShowFirstAvailableSlot?: boolean;
  bookingWindow?: BookingWindow | null;
  bookingLimitsCount?: BookingLimits | null;
  bookingLimitsDuration?: BookingLimits | null;
  /** `collective` intersects hosts, `roundRobin` unions them. */
  schedulingType?: "collective" | "roundRobin" | "managed" | null;
  seatsPerTimeSlot?: number | null;
  /** Seats already taken, keyed by slot start ISO. */
  bookedSeats?: Map<string, number>;
  /** Existing bookings of this event type, for booking-limit evaluation. */
  eventTypeBookings?: ExistingBooking[];
  /** Timezone limits are evaluated in (organizer/team timezone). */
  limitsTimeZone?: string;
  weekStart?: "Sunday" | "Monday";
  now?: number;
}

export interface GeneratedSlot {
  start: number;
  end: number;
  hostIds: number[];
  seatsRemaining?: number;
  seatsTotal?: number;
}

const DAY_MS = 86400000;

/** Working intervals of one host over the requested range, minus busy time. */
export function hostFreeIntervals(host: HostSchedule, from: number, to: number): Interval[] {
  const dates = datesBetween(new Date(from - DAY_MS), new Date(to + DAY_MS), host.timeZone);
  const oooDates = new Set<string>();
  for (const span of host.ooo) {
    let cursor = span.startDate;
    for (let guard = 0; guard < 800; guard += 1) {
      oooDates.add(cursor);
      if (cursor === span.endDate || cursor > span.endDate) break;
      cursor = addDaysISO(cursor, 1);
    }
  }

  const overridesByDate = new Map<string, DateOverride[]>();
  for (const override of host.overrides) {
    const list = overridesByDate.get(override.date) ?? [];
    list.push(override);
    overridesByDate.set(override.date, list);
  }

  const working: Interval[] = [];
  for (const date of dates) {
    if (oooDates.has(date)) continue;

    const overrides = overridesByDate.get(date);
    let ranges: Array<{ startTime: string; endTime: string }>;
    if (overrides && overrides.length > 0) {
      ranges = overrides
        .filter((o) => o.startTime !== null && o.endTime !== null)
        .map((o) => ({ startTime: o.startTime as string, endTime: o.endTime as string }));
    } else {
      const weekday = weekdayOfDateISO(date);
      ranges = host.weekly
        .filter((slot) => slot.day === weekday)
        .map((slot) => ({ startTime: slot.startTime, endTime: slot.endTime }));
    }

    for (const range of ranges) {
      const startsAtMidnight = toMinutes(range.endTime) <= toMinutes(range.startTime);
      const start = zonedTimeToUtc(date, range.startTime, host.timeZone).getTime();
      // `24:00` and wrap-around ranges end on the next date.
      const end = startsAtMidnight
        ? zonedTimeToUtc(addDaysISO(date, 1), range.endTime, host.timeZone).getTime()
        : zonedTimeToUtc(date, range.endTime, host.timeZone).getTime();
      if (end > start) working.push({ start, end });
    }
  }

  return subtract(normalize(working), host.busy);
}

function bookingWindowBound(window: BookingWindow, now: number, timeZone: string): Interval | null {
  if (window.type === "range") {
    if (!window.startDate || !window.endDate) return null;
    return {
      start: zonedTimeToUtc(window.startDate, "00:00", timeZone).getTime(),
      end: zonedTimeToUtc(addDaysISO(window.endDate, 1), "00:00", timeZone).getTime(),
    };
  }
  const value = window.value ?? 0;
  if (value <= 0) return null;
  const today = zonedDateISO(new Date(now), timeZone);
  let cursor = today;
  if (window.type === "calendarDays") {
    cursor = addDaysISO(today, value);
  } else {
    let remaining = value;
    for (let guard = 0; guard < 800 && remaining > 0; guard += 1) {
      cursor = addDaysISO(cursor, 1);
      const weekday = weekdayOfDateISO(cursor);
      if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }
  }
  // Rolling windows count from today; non-rolling windows still end at that date.
  return {
    start: now,
    end: zonedTimeToUtc(addDaysISO(cursor, 1), "00:00", timeZone).getTime(),
  };
}

interface PeriodKeys {
  day: string;
  week: string;
  month: string;
  year: string;
}

function periodKeys(instant: number, timeZone: string, weekStart: "Sunday" | "Monday"): PeriodKeys {
  const date = zonedDateISO(new Date(instant), timeZone);
  return {
    day: date,
    week: startOfWeekISO(date, weekStart),
    month: startOfMonthISO(date),
    year: startOfYearISO(date),
  };
}

interface LimitTally {
  count: Map<string, number>;
  minutes: Map<string, number>;
}

function tallyBookings(
  bookings: ExistingBooking[],
  timeZone: string,
  weekStart: "Sunday" | "Monday"
): LimitTally {
  const count = new Map<string, number>();
  const minutes = new Map<string, number>();
  for (const booking of bookings) {
    const keys = periodKeys(booking.start, timeZone, weekStart);
    const duration = Math.max(0, Math.round((booking.end - booking.start) / 60000));
    for (const [period, key] of Object.entries(keys)) {
      const countKey = `${period}:${key}`;
      count.set(countKey, (count.get(countKey) ?? 0) + 1);
      minutes.set(countKey, (minutes.get(countKey) ?? 0) + duration);
    }
  }
  return { count, minutes };
}

function withinLimits(
  slot: Interval,
  tally: LimitTally,
  limitsCount: BookingLimits | null | undefined,
  limitsDuration: BookingLimits | null | undefined,
  timeZone: string,
  weekStart: "Sunday" | "Monday",
  durationMinutes: number
): boolean {
  if (!limitsCount && !limitsDuration) return true;
  const keys = periodKeys(slot.start, timeZone, weekStart);
  for (const period of ["day", "week", "month", "year"] as const) {
    const key = `${period}:${keys[period]}`;
    const maxCount = limitsCount?.[period];
    if (typeof maxCount === "number" && (tally.count.get(key) ?? 0) + 1 > maxCount) return false;
    const maxMinutes = limitsDuration?.[period];
    if (
      typeof maxMinutes === "number" &&
      (tally.minutes.get(key) ?? 0) + durationMinutes > maxMinutes
    ) {
      return false;
    }
  }
  return true;
}

export function generateSlots(hosts: HostSchedule[], options: SlotOptions): GeneratedSlot[] {
  if (hosts.length === 0) return [];

  const now = options.now ?? Date.now();
  const duration = options.durationMinutes;
  const step = (options.slotIntervalMinutes ?? 0) > 0 ? (options.slotIntervalMinutes as number) : duration;
  const limitsTimeZone = options.limitsTimeZone ?? hosts[0].timeZone;
  const weekStart = options.weekStart ?? "Monday";

  const earliest = now + (options.minimumBookingNotice ?? 0) * 60000;
  let windowStart = Math.max(options.from, earliest);
  let windowEnd = options.to;

  if (options.bookingWindow) {
    const bound = bookingWindowBound(options.bookingWindow, now, limitsTimeZone);
    if (bound) {
      windowStart = Math.max(windowStart, bound.start);
      windowEnd = Math.min(windowEnd, bound.end);
    }
  }
  if (windowEnd <= windowStart) return [];

  const perHost = hosts.map((host) => ({
    host,
    free: hostFreeIntervals(host, windowStart, windowEnd),
  }));

  const combined =
    options.schedulingType === "collective"
      ? intersectAll(perHost.map((entry) => entry.free))
      : union(perHost.map((entry) => entry.free));

  const tally = tallyBookings(options.eventTypeBookings ?? [], limitsTimeZone, weekStart);
  const seats = options.seatsPerTimeSlot ?? null;
  const bookedSeats = options.bookedSeats ?? new Map<string, number>();

  const slots: GeneratedSlot[] = [];
  const seenStarts = new Set<number>();
  const offsetMs = (options.offsetStartMinutes ?? 0) * 60000;

  for (const interval of combined) {
    // Grid is anchored to the interval start so slots line up with the workday.
    let cursor = interval.start + offsetMs;
    for (let guard = 0; guard < 5000; guard += 1) {
      const slot = { start: cursor, end: cursor + duration * 60000 };
      if (slot.end > interval.end) break;
      cursor += step * 60000;

      if (slot.start < windowStart || slot.end > windowEnd) continue;
      if (seenStarts.has(slot.start)) continue;

      const hostIds = perHost
        .filter((entry) => contains(entry.free, slot))
        .map((entry) => entry.host.userId);
      if (hostIds.length === 0) continue;
      if (options.schedulingType === "collective" && hostIds.length !== hosts.length) continue;

      const startISO = new Date(slot.start).toISOString();
      const taken = bookedSeats.get(startISO) ?? 0;
      if (seats !== null && taken >= seats) continue;

      if (
        !withinLimits(
          slot,
          tally,
          options.bookingLimitsCount,
          options.bookingLimitsDuration,
          limitsTimeZone,
          weekStart,
          duration
        )
      ) {
        continue;
      }

      seenStarts.add(slot.start);
      slots.push({
        start: slot.start,
        end: slot.end,
        hostIds,
        ...(seats !== null ? { seatsRemaining: seats - taken, seatsTotal: seats } : {}),
      });
    }
  }

  slots.sort((a, b) => a.start - b.start);

  if (options.onlyShowFirstAvailableSlot) {
    const firstPerDate = new Map<string, GeneratedSlot>();
    for (const slot of slots) {
      const date = zonedDateISO(new Date(slot.start), limitsTimeZone);
      if (!firstPerDate.has(date)) firstPerDate.set(date, slot);
    }
    return [...firstPerDate.values()];
  }

  return slots;
}

/** Group slots by date as seen in `timeZone`, matching the cal.com slots payload. */
export function groupSlotsByDate(
  slots: GeneratedSlot[],
  timeZone: string
): Record<string, GeneratedSlot[]> {
  const grouped: Record<string, GeneratedSlot[]> = {};
  for (const slot of slots) {
    const date = zonedDateISO(new Date(slot.start), timeZone);
    (grouped[date] ??= []).push(slot);
  }
  return grouped;
}

/** True when `start` is a bookable slot for these hosts — used at booking time. */
export function isSlotBookable(
  hosts: HostSchedule[],
  start: number,
  options: SlotOptions
): GeneratedSlot | null {
  const slots = generateSlots(hosts, {
    ...options,
    from: start,
    to: start + options.durationMinutes * 60000,
    onlyShowFirstAvailableSlot: false,
  });
  return slots.find((slot) => slot.start === start) ?? null;
}
