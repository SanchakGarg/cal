// Bridges the database and the pure slot engine: loads each host's schedule,
// out-of-office spans and busy time for a window.

import { query } from "../../db/pool.ts";
import { externalBusyByUser } from "../../lib/calendar-sync.ts";
import type { EventTypeRow } from "../serialize.ts";
import type {
  BookingLimits,
  BookingWindow,
  ExistingBooking,
  HostSchedule,
  SlotOptions,
} from "../../lib/slots.ts";

export interface HostRef {
  userId: number;
  timeZone: string;
  /**
   * Every schedule that applies to this host on this event type. Usually one,
   * but a host may pick several, and their hours are then the union. Empty means
   * the host has no availability at all for this event.
   */
  scheduleIds: number[];
  mandatory?: boolean;
  priority?: string;
  weight?: number;
}

/**
 * Which schedules apply to one host, in precedence order:
 *
 *   1. what the host chose for this event type
 *   2. the schedule the event type pins for everyone, if it still applies
 *   3. the host's default schedule
 *
 * An empty result means the host offers no hours here at all — which is a real
 * answer, not a bug: it happens when their only schedule is marked personal-only
 * and this is a team event.
 */
export function pickScheduleIds(input: {
  chosen: number[];
  eventTypeScheduleId: number | null;
  defaultScheduleId: number | null;
  /** Schedules allowed in this context; excludes personal-only ones on a team. */
  usableIds: Set<number>;
}): number[] {
  if (input.chosen.length > 0) return input.chosen;
  for (const candidate of [input.eventTypeScheduleId, input.defaultScheduleId]) {
    if (candidate !== null && input.usableIds.has(candidate)) return [candidate];
  }
  return [];
}

/**
 * The schedules that apply to each host of an event type.
 *
 * A host's own selection wins. With no selection they fall back to the event
 * type's schedule, and failing that to their default schedule — which is how
 * every event type behaved before hosts could choose.
 *
 * A schedule the member marked personal-only never counts towards a team event.
 * The host stays in the list with no hours, so a round robin never offers them
 * and a collective event — which needs everyone free — finds no slot, rather
 * than quietly booking a time they never offered.
 */
export async function resolveHosts(eventType: EventTypeRow): Promise<HostRef[]> {
  const isTeam = Boolean(eventType.team_id);

  // One shape for both cases; the team-only columns come back undefined for a
  // personal event, which is what HostRef already allows.
  interface BaseHost {
    userId: number;
    timeZone: string;
    defaultScheduleId: number | null;
    mandatory?: boolean;
    priority?: string;
    weight?: number;
  }

  const base: BaseHost[] = isTeam
    ? await query<BaseHost>(
        `SELECT h.user_id AS "userId", u.time_zone AS "timeZone",
                u.default_schedule_id AS "defaultScheduleId",
                h.mandatory, h.priority, h.weight
         FROM event_type_hosts h
         JOIN users u ON u.id = h.user_id
         WHERE h.event_type_id = $1
         ORDER BY h.user_id`,
        [eventType.id]
      )
    : eventType.owner_id
      ? await query<BaseHost>(
          `SELECT u.id AS "userId", u.time_zone AS "timeZone",
                  u.default_schedule_id AS "defaultScheduleId"
           FROM users u WHERE u.id = $1`,
          [eventType.owner_id]
        )
      : [];

  if (base.length === 0) return [];

  const [chosen, usable] = await Promise.all([
    query<{ user_id: number; schedule_id: number }>(
      `SELECT a.user_id, a.schedule_id
       FROM event_type_availability a
       JOIN schedules s ON s.id = a.schedule_id
       WHERE a.event_type_id = $1
         -- A schedule kept off team events is skipped even if it was chosen.
         AND ($2::bool IS FALSE OR s.exclude_from_team IS FALSE)`,
      [eventType.id, isTeam]
    ),
    // Fallback schedules have to pass the same personal-only check.
    query<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM schedules
       WHERE user_id = ANY($1::int[])
         AND ($2::bool IS FALSE OR exclude_from_team IS FALSE)`,
      [base.map((host) => host.userId), isTeam]
    ),
  ]);

  const chosenByUser = new Map<number, number[]>();
  for (const row of chosen) {
    chosenByUser.set(row.user_id, [...(chosenByUser.get(row.user_id) ?? []), row.schedule_id]);
  }
  const usableIds = new Set(usable.map((row) => row.id));

  return base.map((host) => {
    const scheduleIds = pickScheduleIds({
      chosen: chosenByUser.get(host.userId) ?? [],
      eventTypeScheduleId: eventType.schedule_id,
      defaultScheduleId: host.defaultScheduleId,
      usableIds,
    });
    return {
      userId: host.userId,
      timeZone: host.timeZone,
      scheduleIds,
      mandatory: host.mandatory,
      priority: host.priority,
      weight: host.weight,
    } satisfies HostRef;
  });
}

interface AvailabilityRow {
  schedule_id: number;
  day: number;
  start_time: string;
  end_time: string;
}

interface OverrideRow {
  schedule_id: number;
  date: Date | string;
  start_time: string | null;
  end_time: string | null;
}

interface OooRow {
  user_id: number;
  start_date: Date | string;
  end_date: Date | string;
}

interface BusyRow {
  user_id: number;
  start_time: Date;
  end_time: Date;
}

const hhmm = (value: string): string => value.slice(0, 5);
const isoDate = (value: Date | string): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export interface LoadOptions {
  from: Date;
  to: Date;
  /** Exclude these bookings from busy time (used when rescheduling). */
  ignoreBookingUids?: string[];
  /** Exclude this reservation from busy time (the client holding the slot). */
  ignoreReservationUid?: string;
}

export async function loadHostSchedules(
  hosts: HostRef[],
  eventType: EventTypeRow,
  options: LoadOptions
): Promise<HostSchedule[]> {
  if (hosts.length === 0) return [];
  const userIds = hosts.map((host) => host.userId);
  const scheduleIds = [...new Set(hosts.flatMap((host) => host.scheduleIds))];

  // Widen the query window by a day on each side so timezone shifts stay covered.
  const from = new Date(options.from.getTime() - 86400000);
  const to = new Date(options.to.getTime() + 86400000);
  const buffers = {
    before: eventType.before_event_buffer ?? 0,
    after: eventType.after_event_buffer ?? 0,
  };

  const [availability, overrides, ooo, busy, reservations, externalBusy] = await Promise.all([
    scheduleIds.length
      ? query<AvailabilityRow>(
          "SELECT schedule_id, day, start_time, end_time FROM availability WHERE schedule_id = ANY($1::int[])",
          [scheduleIds]
        )
      : Promise.resolve([]),
    scheduleIds.length
      ? query<OverrideRow>(
          `SELECT schedule_id, date, start_time, end_time FROM date_overrides
           WHERE schedule_id = ANY($1::int[]) AND date BETWEEN $2::date AND $3::date`,
          [scheduleIds, isoDate(from), isoDate(to)]
        )
      : Promise.resolve([]),
    query<OooRow>(
      `SELECT user_id, start_date, end_date FROM out_of_office
       WHERE user_id = ANY($1::int[]) AND end_date >= $2::date AND start_date <= $3::date`,
      [userIds, isoDate(from), isoDate(to)]
    ),
    // Busy time is collected per user across EVERY event type they host, so a
    // personal booking blocks their team slots and vice versa.
    query<BusyRow>(
      `SELECT h.user_id, b.start_time, b.end_time
       FROM bookings b
       JOIN booking_hosts h ON h.booking_id = b.id
       WHERE h.user_id = ANY($1::int[])
         AND b.status IN ('accepted', 'pending')
         AND b.end_time > $2 AND b.start_time < $3
         AND ($4::text[] IS NULL OR NOT (b.uid = ANY($4::text[])))`,
      [userIds, from, to, options.ignoreBookingUids ?? null]
    ),
    query<{ slot_start: Date; slot_duration: number }>(
      `SELECT slot_start, slot_duration FROM slot_reservations
       WHERE event_type_id = $1 AND expires_at > now()
         AND slot_start >= $2 AND slot_start < $3
         AND ($4::text IS NULL OR uid <> $4::text)`,
      [eventType.id, from, to, options.ignoreReservationUid ?? null]
    ),
    // Events living only on a linked Google Calendar block slots too, so a host
    // is never offered a time they are already busy for elsewhere.
    externalBusyByUser(userIds, from, to),
  ]);

  const reservationBusy = reservations.map((row) => ({
    start: row.slot_start.getTime() - buffers.before * 60000,
    end: row.slot_start.getTime() + (row.slot_duration + buffers.after) * 60000,
  }));

  return hosts.map((host) => {
    // Several schedules union: their weekly blocks are concatenated and the slot
    // engine merges the overlaps. Date overrides concatenate the same way, so a
    // date with real hours in one schedule stays bookable even if another marks
    // it unavailable — the wider window wins, matching the union everywhere else.
    const applies = new Set(host.scheduleIds);
    return {
      userId: host.userId,
      timeZone: host.timeZone,
      weekly: availability
        .filter((row) => applies.has(row.schedule_id))
        .map((row) => ({
          day: row.day,
          startTime: hhmm(row.start_time),
          endTime: hhmm(row.end_time),
        })),
      overrides: overrides
        .filter((row) => applies.has(row.schedule_id))
        .map((row) => ({
          date: isoDate(row.date),
          startTime: row.start_time ? hhmm(row.start_time) : null,
          endTime: row.end_time ? hhmm(row.end_time) : null,
        })),
      ooo: ooo
        .filter((row) => row.user_id === host.userId)
        .map((row) => ({ startDate: isoDate(row.start_date), endDate: isoDate(row.end_date) })),
      busy: [
        ...busy
          .filter((row) => row.user_id === host.userId)
          .map((row) => ({
            start: row.start_time.getTime() - buffers.before * 60000,
            end: row.end_time.getTime() + buffers.after * 60000,
          })),
        ...(externalBusy.get(host.userId) ?? []).map((span) => ({
          start: span.start - buffers.before * 60000,
          end: span.end + buffers.after * 60000,
        })),
        ...reservationBusy,
      ],
    } satisfies HostSchedule;
  });
}

function asLimits(value: unknown): BookingLimits | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const limits: BookingLimits = {};
  for (const period of ["day", "week", "month", "year"] as const) {
    if (typeof raw[period] === "number") limits[period] = raw[period] as number;
  }
  return Object.keys(limits).length ? limits : null;
}

function asWindow(value: unknown): BookingWindow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== "string") return null;
  return {
    type: raw.type as BookingWindow["type"],
    value: typeof raw.value === "number" ? raw.value : undefined,
    rolling: typeof raw.rolling === "boolean" ? raw.rolling : undefined,
    startDate: typeof raw.startDate === "string" ? raw.startDate : undefined,
    endDate: typeof raw.endDate === "string" ? raw.endDate : undefined,
  };
}

export async function loadEventTypeBookings(
  eventTypeId: number,
  ignoreUids: string[] = []
): Promise<ExistingBooking[]> {
  const rows = await query<{ start_time: Date; end_time: Date }>(
    `SELECT start_time, end_time FROM bookings
     WHERE event_type_id = $1 AND status IN ('accepted', 'pending')
       AND ($2::text[] IS NULL OR NOT (uid = ANY($2::text[])))`,
    [eventTypeId, ignoreUids.length ? ignoreUids : null]
  );
  return rows.map((row) => ({ start: row.start_time.getTime(), end: row.end_time.getTime() }));
}

export async function loadBookedSeats(eventTypeId: number): Promise<Map<string, number>> {
  const rows = await query<{ start_time: Date; seats: number }>(
    `SELECT b.start_time, COUNT(a.id)::int AS seats
     FROM bookings b
     JOIN booking_attendees a ON a.booking_id = b.id AND a.is_guest = FALSE
     WHERE b.event_type_id = $1 AND b.status IN ('accepted', 'pending')
     GROUP BY b.start_time`,
    [eventTypeId]
  );
  const seats = new Map<string, number>();
  for (const row of rows) seats.set(row.start_time.toISOString(), row.seats);
  return seats;
}

/** Turns an event type row into the engine's option bag. */
export async function slotOptionsFor(
  eventType: EventTypeRow,
  params: {
    from: Date;
    to: Date;
    durationMinutes?: number;
    limitsTimeZone?: string;
    weekStart?: "Sunday" | "Monday";
    ignoreBookingUids?: string[];
    now?: number;
  }
): Promise<SlotOptions> {
  const duration = params.durationMinutes ?? eventType.length_in_minutes;
  const [eventTypeBookings, bookedSeats] = await Promise.all([
    loadEventTypeBookings(eventType.id, params.ignoreBookingUids ?? []),
    eventType.seats_per_time_slot ? loadBookedSeats(eventType.id) : Promise.resolve(undefined),
  ]);

  return {
    from: params.from.getTime(),
    to: params.to.getTime(),
    durationMinutes: duration,
    slotIntervalMinutes: eventType.slot_interval,
    minimumBookingNotice: eventType.minimum_booking_notice,
    offsetStartMinutes: eventType.offset_start,
    onlyShowFirstAvailableSlot: eventType.only_show_first_available_slot,
    bookingWindow: asWindow(eventType.booking_window),
    bookingLimitsCount: asLimits(eventType.booking_limits_count),
    bookingLimitsDuration: asLimits(eventType.booking_limits_duration),
    schedulingType: eventType.scheduling_type,
    seatsPerTimeSlot: eventType.seats_per_time_slot,
    bookedSeats,
    eventTypeBookings,
    limitsTimeZone: params.limitsTimeZone,
    weekStart: params.weekStart,
    now: params.now,
  };
}
