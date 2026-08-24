// Client-side timezone and formatting helpers. Same Intl approach as the server.

export const WEEK_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export type WeekDayName = (typeof WEEK_DAYS)[number];

const pad = (value: number): string => String(value).padStart(2, "0");

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

export function timeZoneList(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  if (typeof supported === "function") return supported("timeZone");
  return ["UTC", "Europe/London", "America/New_York", "Asia/Kolkata", "Australia/Sydney"];
}

export function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

export function zonedTimeToUtc(dateISO: string, timeHHMM: string, timeZone: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  const [hour, minute] = timeHHMM.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(naive);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const corrected = new Date(naive - zoneOffsetMinutes(instant, timeZone) * 60000);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant;
}

export function dateISOInZone(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function todayISO(timeZone: string): string {
  return dateISOInZone(new Date(), timeZone);
}

export function addDaysISO(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function addMonthsISO(dateISO: string, months: number): string {
  const [year, month] = dateISO.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`;
}

export function weekdayOfDateISO(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysInMonth(dateISO: string): number {
  const [year, month] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthLabel(dateISO: string): string {
  const [year, month] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateISO(dateISO: string, options: Intl.DateTimeFormatOptions = {}): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
    ...options,
  });
}

export function formatTime(instant: Date, timeZone: string, timeFormat: 12 | 24 = 12): string {
  return instant.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === 12,
  });
}

export function formatDateTime(instant: Date, timeZone: string, timeFormat: 12 | 24 = 12): string {
  return instant.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === 12,
  });
}

/** `09:00` to `9:00am` (or 24 hour form). */
export function formatHHMM(time: string, timeFormat: 12 | 24 = 12): string {
  const [hour, minute] = time.split(":").map(Number);
  if (timeFormat === 24) return `${pad(hour)}:${pad(minute)}`;
  const suffix = hour >= 12 ? "pm" : "am";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${pad(minute)}${suffix}`;
}

export function timeOptions(stepMinutes = 15): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes <= 24 * 60; minutes += stepMinutes) {
    if (minutes === 24 * 60) {
      options.push("23:59");
      break;
    }
    options.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }
  return options;
}

export function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Mon - Fri, 9:00am - 5:00pm" summary used by the availability list. */
export function availabilitySummary(
  availability: Array<{ days: string[]; startTime: string; endTime: string }>,
  timeFormat: 12 | 24 = 12
): string {
  if (availability.length === 0) return "No availability";
  return availability
    .map((entry) => {
      const indexes = entry.days
        .map((day) => WEEK_DAYS.indexOf(day as WeekDayName))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);
      const label = compactDayRange(indexes);
      return `${label}, ${formatHHMM(entry.startTime, timeFormat)} - ${formatHHMM(entry.endTime, timeFormat)}`;
    })
    .join("; ");
}

function compactDayRange(indexes: number[]): string {
  if (indexes.length === 0) return "";
  const short = (index: number): string => WEEK_DAYS[index].slice(0, 3);
  const groups: string[] = [];
  let start = indexes[0];
  let previous = indexes[0];
  for (const index of indexes.slice(1)) {
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    groups.push(start === previous ? short(start) : `${short(start)} - ${short(previous)}`);
    start = index;
    previous = index;
  }
  groups.push(start === previous ? short(start) : `${short(start)} - ${short(previous)}`);
  return groups.join(", ");
}
