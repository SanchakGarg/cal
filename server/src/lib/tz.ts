// Timezone math without any dependency. Everything leans on Intl.DateTimeFormat,
// which knows the IANA database, so DST is handled by the platform.

/**
 * The zone used whenever we have to store one but nobody told us which — new
 * accounts, new schedules, new teams, and requests that omit `timeZone`.
 * Public booking pages are unaffected: they use the visitor's detected zone.
 */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = partsCache.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, cached);
  }
  return cached;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `instant` as rendered in `timeZone`. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` at `instant`, in minutes east of UTC. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = utcToZonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` to the matching UTC instant.
 * Guess with the naive offset, then correct — twice, so DST boundaries settle.
 */
export function zonedTimeToUtc(
  dateISO: string,
  timeHHMM: string,
  timeZone: string
): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  const [hour, minute] = timeHHMM.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(naive);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = zoneOffsetMinutes(instant, timeZone);
    const corrected = new Date(naive - offset * 60000);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant;
}

/** `YYYY-MM-DD` for `instant` as seen in `timeZone`. */
export function zonedDateISO(instant: Date, timeZone: string): string {
  const { year, month, day } = utcToZonedParts(instant, timeZone);
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** `HH:MM` for `instant` as seen in `timeZone`. */
export function zonedTimeHHMM(instant: Date, timeZone: string): string {
  const { hour, minute } = utcToZonedParts(instant, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 0 = Sunday .. 6 = Saturday, in `timeZone`. */
export function zonedWeekday(instant: Date, timeZone: string): number {
  const { year, month, day } = utcToZonedParts(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekdayOfDateISO(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Inclusive list of `YYYY-MM-DD` dates as seen in `timeZone`. */
export function datesBetween(from: Date, to: Date, timeZone: string): string[] {
  const dates: string[] = [];
  let cursor = zonedDateISO(from, timeZone);
  const last = zonedDateISO(to, timeZone);
  // Guard against runaway loops on absurd ranges (about 2 years).
  for (let index = 0; index < 800; index += 1) {
    dates.push(cursor);
    if (cursor === last) break;
    cursor = addDaysISO(cursor, 1);
  }
  return dates;
}

export function addDaysISO(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad4(next.getUTCFullYear())}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function minutesBetweenISOTimes(startHHMM: string, endHHMM: string): number {
  return toMinutes(endHHMM) - toMinutes(startHHMM);
}

export function toMinutes(timeHHMM: string): number {
  const [hour, minute] = timeHHMM.split(":").map(Number);
  return hour * 60 + minute;
}

export function fromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, total));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** Start of the day containing `instant`, in `timeZone`, as a UTC instant. */
export function startOfZonedDay(instant: Date, timeZone: string): Date {
  return zonedTimeToUtc(zonedDateISO(instant, timeZone), "00:00", timeZone);
}

/** Start of the week (per `weekStart`) containing `dateISO`. */
export function startOfWeekISO(dateISO: string, weekStart: "Sunday" | "Monday"): string {
  const weekday = weekdayOfDateISO(dateISO);
  const offset = weekStart === "Monday" ? (weekday + 6) % 7 : weekday;
  return addDaysISO(dateISO, -offset);
}

export function startOfMonthISO(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

export function startOfYearISO(dateISO: string): string {
  return `${dateISO.slice(0, 4)}-01-01`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}
