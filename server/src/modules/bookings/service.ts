// Booking creation and mutation. Availability is re-checked inside the
// transaction so two concurrent bookers cannot take the same slot.

import { randomUUID } from "node:crypto";
import { type Tx, query, queryOne, withTransaction } from "../../db/pool.ts";
import { badRequest, conflict, forbidden, notFound } from "../../http/errors.ts";
import { isSlotBookable } from "../../lib/slots.ts";
import { dispatchWebhooks } from "../../lib/webhooks.ts";
import {
  notifyBookingCancelled,
  notifyBookingCreated,
  notifyBookingDecision,
  notifyBookingRescheduled,
  notifyRescheduleRequested,
} from "./notify.ts";
import { invalidateBusyCache, syncBookingToCalendars } from "../../lib/calendar-sync.ts";
import { addDaysISO } from "../../lib/tz.ts";
import {
  type BookingAttendeeRow,
  type BookingHostRecord,
  type BookingRow,
  type EventTypeRow,
  serializeBooking,
} from "../serialize.ts";
import { loadHostSchedules, resolveHosts, slotOptionsFor } from "../availability/loader.ts";

export interface AttendeeInput {
  name: string;
  email: string;
  timeZone: string;
  language?: string;
  phoneNumber?: string;
}

export interface CreateBookingInput {
  start: Date;
  eventType: EventTypeRow;
  attendee: AttendeeInput;
  guests?: string[];
  lengthInMinutes?: number;
  location?: string;
  meetingUrl?: string;
  metadata?: Record<string, unknown>;
  bookingFieldsResponses?: Record<string, unknown>;
  bookedByUserId?: number | null;
  recurrenceCount?: number;
  reservationUid?: string;
}

const BOOKING_COLUMNS = `
  id, uid, event_type_id, user_id, title, description, start_time, end_time, status, location,
  meeting_url, cancellation_reason, cancelled_by_email, rescheduling_reason, rescheduled_by_email,
  rescheduled_from_uid, rescheduled_to_uid, recurring_event_uid, absent_host, ics_uid, rating,
  booking_fields_responses, metadata, created_at, updated_at`;

/** Round robin picks the least-recently-booked candidate, weight breaking ties. */
export async function pickRoundRobinHost(
  eventTypeId: number,
  candidateIds: number[]
): Promise<number> {
  if (candidateIds.length === 1) return candidateIds[0];
  const rows = await query<{ user_id: number; last_booking: Date | null; weight: number; priority: string }>(
    `SELECT h.user_id, h.weight, h.priority, MAX(b.created_at) AS last_booking
     FROM event_type_hosts h
     LEFT JOIN booking_hosts bh ON bh.user_id = h.user_id
     LEFT JOIN bookings b ON b.id = bh.booking_id AND b.event_type_id = $1
                          AND b.status IN ('accepted', 'pending')
     WHERE h.event_type_id = $1 AND h.user_id = ANY($2::int[])
     GROUP BY h.user_id, h.weight, h.priority`,
    [eventTypeId, candidateIds]
  );
  const priorityRank: Record<string, number> = {
    highest: 5,
    high: 4,
    medium: 3,
    low: 2,
    lowest: 1,
  };
  const sorted = rows.sort((a, b) => {
    const priority = (priorityRank[b.priority] ?? 3) - (priorityRank[a.priority] ?? 3);
    if (priority !== 0) return priority;
    const aTime = a.last_booking?.getTime() ?? 0;
    const bTime = b.last_booking?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return b.weight - a.weight;
  });
  return sorted[0]?.user_id ?? candidateIds[0];
}

function requiresConfirmation(eventType: EventTypeRow, start: Date): boolean {
  const policy = eventType.confirmation_policy as
    | { type?: string; noticeThreshold?: { count: number; unit: "minutes" | "hours" } }
    | null;
  if (!policy || !policy.type) return false;
  if (policy.type === "always") return true;
  if (policy.type === "time" && policy.noticeThreshold) {
    const minutes =
      policy.noticeThreshold.unit === "hours"
        ? policy.noticeThreshold.count * 60
        : policy.noticeThreshold.count;
    return start.getTime() - Date.now() < minutes * 60000;
  }
  return false;
}

function resolveLocation(eventType: EventTypeRow, requested?: string): string {
  const locations = (eventType.locations as Array<Record<string, unknown>>) ?? [];
  if (requested) return requested;
  const first = locations[0];
  if (!first) return "";
  switch (first.type) {
    case "integration":
      return String(first.integration ?? "");
    case "link":
      return String(first.link ?? "");
    case "address":
      return String(first.address ?? "");
    case "phone":
      return String(first.phone ?? "");
    default:
      return String(first.type ?? "");
  }
}

const SYSTEM_HANDLED_FIELDS = ["name", "email", "location", "guests", "rescheduleReason", "title"];
/** Option types that accept more than one answer. */
const MULTI_ANSWER_TYPES = new Set(["multiselect", "checkbox"]);
const DATE_ANSWER_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ANSWER_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates responses against the event type's booking fields. */
export function validateBookingFields(
  eventType: EventTypeRow,
  responses: Record<string, unknown>
): Record<string, unknown> {
  const fields = (eventType.booking_fields as Array<Record<string, unknown>>) ?? [];
  const validated: Record<string, unknown> = {};
  const known = new Set<string>();

  for (const field of fields) {
    const slug = String(field.slug);
    known.add(slug);
    const type = String(field.type);
    const systemHandled = SYSTEM_HANDLED_FIELDS.includes(type);
    const value = responses[slug];

    if (value === undefined || value === null || value === "" ||
        (Array.isArray(value) && value.length === 0)) {
      if (field.required === true && !systemHandled) {
        throw badRequest(`bookingFieldsResponses.${slug} is required`);
      }
      continue;
    }

    if (Array.isArray(field.options)) {
      const options = field.options as string[];
      const values = Array.isArray(value) ? value : [value];
      if (!MULTI_ANSWER_TYPES.has(type) && values.length > 1) {
        throw badRequest(`bookingFieldsResponses.${slug} accepts a single answer`);
      }
      for (const entry of values) {
        if (!options.includes(String(entry))) {
          throw badRequest(`bookingFieldsResponses.${slug} must be one of ${options.join(", ")}`);
        }
      }
      if (new Set(values.map(String)).size !== values.length) {
        throw badRequest(`bookingFieldsResponses.${slug} must not repeat an option`);
      }
      const min = typeof field.minSelections === "number" ? field.minSelections : undefined;
      const max = typeof field.maxSelections === "number" ? field.maxSelections : undefined;
      if (min !== undefined && values.length < min) {
        throw badRequest(`bookingFieldsResponses.${slug} needs at least ${min} selection(s)`);
      }
      if (max !== undefined && values.length > max) {
        throw badRequest(`bookingFieldsResponses.${slug} allows at most ${max} selection(s)`);
      }
    }

    if (type === "rating") {
      const max = typeof field.maxRating === "number" ? field.maxRating : 5;
      const score = Number(value);
      if (!Number.isInteger(score) || score < 1 || score > max) {
        throw badRequest(`bookingFieldsResponses.${slug} must be a whole number between 1 and ${max}`);
      }
      validated[slug] = score;
      continue;
    }

    if (type === "date" && !DATE_ANSWER_RE.test(String(value))) {
      throw badRequest(`bookingFieldsResponses.${slug} must look like 2026-08-24`);
    }
    if (type === "time" && !TIME_ANSWER_RE.test(String(value))) {
      throw badRequest(`bookingFieldsResponses.${slug} must look like 14:30`);
    }
    if (type === "number" && !Number.isFinite(Number(value))) {
      throw badRequest(`bookingFieldsResponses.${slug} must be a number`);
    }
    if (type === "multiemail") {
      const emails = Array.isArray(value) ? value : [value];
      for (const entry of emails) {
        if (typeof entry !== "string" || !entry.includes("@")) {
          throw badRequest(`bookingFieldsResponses.${slug} must contain email addresses`);
        }
      }
    }

    validated[slug] = value;
  }

  // Keep extra responses (notes and friends) but do not let an unbounded blob of
  // attacker-chosen keys be persisted against the booking.
  for (const [key, value] of Object.entries(responses)) {
    if (known.has(key) || value === undefined) continue;
    if (Object.keys(validated).length >= fields.length + 10) break;
    validated[key] = value;
  }
  return validated;
}

function bookingTitle(eventType: EventTypeRow, attendeeName: string, hostName: string): string {
  const custom = eventType.custom_name;
  if (custom) {
    return custom
      .replace(/\{Event type title\}/gi, eventType.title)
      .replace(/\{Organiser\}/gi, hostName)
      .replace(/\{Organizer\}/gi, hostName)
      .replace(/\{Scheduler\}/gi, attendeeName);
  }
  return `${eventType.title} between ${hostName} and ${attendeeName}`;
}

export interface BookingContext {
  hostIds: number[];
  primaryHostId: number;
}

async function assertSlotFree(
  eventType: EventTypeRow,
  start: Date,
  durationMinutes: number,
  options: { ignoreBookingUids?: string[]; reservationUid?: string } = {}
): Promise<BookingContext> {
  const hostRefs = await resolveHosts(eventType);
  if (hostRefs.length === 0) throw badRequest("This event type has no hosts assigned");

  const end = new Date(start.getTime() + durationMinutes * 60000);
  const hosts = await loadHostSchedules(hostRefs, eventType, {
    from: start,
    to: end,
    ignoreBookingUids: options.ignoreBookingUids,
    ignoreReservationUid: options.reservationUid,
  });
  const slotOptions = await slotOptionsFor(eventType, {
    from: start,
    to: end,
    durationMinutes,
    limitsTimeZone: hosts[0]?.timeZone,
    ignoreBookingUids: options.ignoreBookingUids,
  });
  const slot = isSlotBookable(hosts, start.getTime(), slotOptions);
  if (!slot) throw conflict("That slot is no longer available");

  const primaryHostId =
    eventType.scheduling_type === "roundRobin"
      ? await pickRoundRobinHost(eventType.id, slot.hostIds)
      : slot.hostIds[0];
  const hostIds = eventType.scheduling_type === "collective" ? slot.hostIds : [primaryHostId];
  return { hostIds, primaryHostId };
}

async function insertBooking(
  tx: Tx,
  params: {
    eventType: EventTypeRow;
    start: Date;
    end: Date;
    status: "accepted" | "pending";
    title: string;
    description: string;
    location: string;
    meetingUrl?: string;
    hostIds: number[];
    primaryHostId: number;
    attendee: AttendeeInput;
    guests: string[];
    responses: Record<string, unknown>;
    metadata: Record<string, unknown>;
    bookedByUserId: number | null;
    recurringUid: string | null;
    seated: boolean;
    existingSeatBookingId?: number;
  }
): Promise<number> {
  let bookingId = params.existingSeatBookingId;

  if (!bookingId) {
    const uid = randomUUID();
    const booking = await tx.queryOne<{ id: number }>(
      `INSERT INTO bookings (uid, event_type_id, user_id, booked_by_user_id, title, description,
                             start_time, end_time, status, location, meeting_url,
                             recurring_event_uid, booking_fields_responses, metadata, ics_uid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)
       RETURNING id`,
      [
        uid,
        params.eventType.id,
        params.primaryHostId,
        params.bookedByUserId,
        params.title,
        params.description,
        params.start,
        params.end,
        params.status,
        params.location,
        params.meetingUrl ?? null,
        params.recurringUid,
        JSON.stringify(params.responses),
        JSON.stringify(params.metadata),
        `${uid}@cal.local`,
      ]
    );
    bookingId = booking!.id;
    for (const hostId of params.hostIds) {
      await tx.query(
        `INSERT INTO booking_hosts (booking_id, user_id, mandatory) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [bookingId, hostId, params.eventType.scheduling_type === "collective"]
      );
    }
  }

  await tx.query(
    `INSERT INTO booking_attendees (booking_id, name, email, time_zone, language, phone_number, seat_uid)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      bookingId,
      params.attendee.name,
      params.attendee.email,
      params.attendee.timeZone,
      params.attendee.language ?? "en",
      params.attendee.phoneNumber ?? null,
      params.seated ? randomUUID() : null,
    ]
  );
  for (const guest of params.guests) {
    await tx.query(
      `INSERT INTO booking_attendees (booking_id, name, email, time_zone, is_guest)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [bookingId, guest.split("@")[0], guest, params.attendee.timeZone]
    );
  }
  return bookingId;
}

export async function loadBooking(uid: string) {
  const booking = await queryOne<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE uid = $1`,
    [uid]
  );
  if (!booking) throw notFound("Booking not found");
  return presentBooking(booking);
}

export async function presentBooking(booking: BookingRow) {
  const [attendees, hosts, eventType] = await Promise.all([
    query<BookingAttendeeRow>(
      `SELECT id, booking_id, name, email, time_zone, language, phone_number, no_show, seat_uid, is_guest
       FROM booking_attendees WHERE booking_id = $1 ORDER BY id`,
      [booking.id]
    ),
    query<BookingHostRecord>(
      `SELECT u.id, u.name, u.email, u.username, u.time_zone AS "timeZone"
       FROM booking_hosts h JOIN users u ON u.id = h.user_id
       WHERE h.booking_id = $1 ORDER BY u.id`,
      [booking.id]
    ),
    booking.event_type_id
      ? queryOne<{ id: number; slug: string; title: string }>(
          "SELECT id, slug, title FROM event_types WHERE id = $1",
          [booking.event_type_id]
        )
      : Promise.resolve(null),
  ]);
  return serializeBooking(booking, attendees, hosts, eventType);
}

export async function createBooking(input: CreateBookingInput) {
  const eventType = input.eventType;
  const duration = input.lengthInMinutes ?? eventType.length_in_minutes;
  if (input.lengthInMinutes) {
    const allowed = [eventType.length_in_minutes, ...(eventType.length_in_minutes_options ?? [])];
    if (!allowed.includes(input.lengthInMinutes)) {
      throw badRequest(`lengthInMinutes must be one of ${allowed.join(", ")}`);
    }
  }
  if (eventType.disable_guests && (input.guests?.length ?? 0) > 0) {
    throw badRequest("This event type does not allow guests");
  }

  const responses = validateBookingFields(eventType, input.bookingFieldsResponses ?? {});
  const recurrence = eventType.recurrence as
    | { interval: number; occurrences: number; frequency: "weekly" | "monthly" | "yearly" }
    | null;

  const starts: Date[] = [input.start];
  if (recurrence && input.recurrenceCount) {
    const occurrences = Math.min(input.recurrenceCount, recurrence.occurrences);
    for (let index = 1; index < occurrences; index += 1) {
      starts.push(nextOccurrence(input.start, recurrence, index));
    }
  }

  const recurringUid = starts.length > 1 ? randomUUID() : null;
  const created: string[] = [];

  for (const start of starts) {
    const context = await assertSlotFree(eventType, start, duration, {
      reservationUid: input.reservationUid,
    });
    const end = new Date(start.getTime() + duration * 60000);
    const status = requiresConfirmation(eventType, start) ? "pending" : "accepted";
    const host = await queryOne<{ name: string }>("SELECT name FROM users WHERE id = $1", [
      context.primaryHostId,
    ]);

    const seated = eventType.seats_per_time_slot !== null;
    const uid = await withTransaction(async (tx) => {
      // Lock the host rows so a concurrent booking for the same slot serialises.
      await tx.query("SELECT id FROM users WHERE id = ANY($1::int[]) FOR UPDATE", [context.hostIds]);

      let existingSeatBookingId: number | undefined;
      if (seated) {
        const existing = await tx.queryOne<{ id: number; seats: number }>(
          `SELECT b.id, COUNT(a.id)::int AS seats
           FROM bookings b
           LEFT JOIN booking_attendees a ON a.booking_id = b.id AND a.is_guest = FALSE
           WHERE b.event_type_id = $1 AND b.start_time = $2 AND b.status IN ('accepted', 'pending')
           GROUP BY b.id`,
          [eventType.id, start]
        );
        if (existing) {
          if (existing.seats >= (eventType.seats_per_time_slot ?? 0)) {
            throw conflict("No seats left for this slot");
          }
          existingSeatBookingId = existing.id;
        }
      } else {
        const clash = await tx.queryOne(
          `SELECT 1 FROM bookings b
           JOIN booking_hosts h ON h.booking_id = b.id
           WHERE h.user_id = ANY($1::int[]) AND b.status IN ('accepted', 'pending')
             AND b.start_time < $3 AND b.end_time > $2`,
          [context.hostIds, start, end]
        );
        if (clash) throw conflict("That slot was just booked");
      }

      const bookingId = await insertBooking(tx, {
        eventType,
        start,
        end,
        status,
        title: bookingTitle(eventType, input.attendee.name, host?.name ?? "Host"),
        description: eventType.description ?? "",
        location: resolveLocation(eventType, input.location),
        meetingUrl: input.meetingUrl,
        hostIds: context.hostIds,
        primaryHostId: context.primaryHostId,
        attendee: input.attendee,
        guests: input.guests ?? [],
        responses,
        metadata: input.metadata ?? {},
        bookedByUserId: input.bookedByUserId ?? null,
        recurringUid,
        seated,
        existingSeatBookingId,
      });
      const row = await tx.queryOne<{ uid: string }>("SELECT uid FROM bookings WHERE id = $1", [
        bookingId,
      ]);
      return row!.uid;
    });
    created.push(uid);
  }

  if (input.reservationUid) {
    await query("DELETE FROM slot_reservations WHERE uid = $1", [input.reservationUid]);
  }

  const bookings = await Promise.all(created.map(loadBooking));
  for (const booking of bookings) {
    await dispatchWebhooks(
      booking.status === "pending" ? "BOOKING_REQUESTED" : "BOOKING_CREATED",
      { userId: eventType.owner_id, teamId: eventType.team_id, eventTypeId: eventType.id },
      booking
    );
    // Mirror onto the hosts' Google Calendars. A pending booking is skipped
    // inside the sync and picked up when it is confirmed.
    await syncBookingToCalendars(booking.id);
  }
  invalidateBusyCache();
  // The Meet link is only known after the event is created, so re-read.
  const synced = await Promise.all(created.map(loadBooking));
  for (const booking of synced) notifyBookingCreated(booking);
  return synced.length === 1 ? synced[0] : synced;
}

function nextOccurrence(
  start: Date,
  recurrence: { interval: number; frequency: "weekly" | "monthly" | "yearly" },
  index: number
): Date {
  const step = recurrence.interval * index;
  const iso = start.toISOString();
  if (recurrence.frequency === "weekly") {
    return new Date(start.getTime() + step * 7 * 86400000);
  }
  const [datePart, timePart] = iso.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const shifted =
    recurrence.frequency === "monthly"
      ? new Date(Date.UTC(year, month - 1 + step, day))
      : new Date(Date.UTC(year + step, month - 1, day));
  return new Date(`${shifted.toISOString().slice(0, 10)}T${timePart}`);
}

export interface MutationActor {
  userId?: number | null;
  email?: string | null;
}

/** The raw row, for callers that need to run an access check before presenting. */
export async function loadBookingRow(uid: string): Promise<BookingRow> {
  return findBookingRow(uid);
}

async function findBookingRow(uid: string): Promise<BookingRow> {
  const booking = await queryOne<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE uid = $1`,
    [uid]
  );
  if (!booking) throw notFound("Booking not found");
  return booking;
}

/** Hosts and the person who booked may mutate a booking; attendees by email. */
export async function assertBookingAccess(
  booking: BookingRow,
  actor: MutationActor
): Promise<void> {
  if (actor.userId) {
    if (booking.user_id === actor.userId) return;
    const host = await queryOne(
      "SELECT 1 FROM booking_hosts WHERE booking_id = $1 AND user_id = $2",
      [booking.id, actor.userId]
    );
    if (host) return;
    const teamAdmin = await queryOne(
      `SELECT 1 FROM event_types e
       JOIN memberships m ON m.team_id = e.team_id AND m.user_id = $2
       WHERE e.id = $1 AND m.role IN ('OWNER', 'ADMIN') AND m.accepted = TRUE`,
      [booking.event_type_id, actor.userId]
    );
    if (teamAdmin) return;
  }
  if (actor.email) {
    const attendee = await queryOne(
      "SELECT 1 FROM booking_attendees WHERE booking_id = $1 AND lower(email) = lower($2)",
      [booking.id, actor.email]
    );
    if (attendee) return;
  }
  throw forbidden("You cannot modify this booking");
}

export async function cancelBooking(
  uid: string,
  actor: MutationActor,
  input: { reason?: string; cancelSubsequentBookings?: boolean }
) {
  const booking = await findBookingRow(uid);
  await assertBookingAccess(booking, actor);
  if (booking.status === "cancelled") throw badRequest("Booking is already cancelled");

  const eventType = booking.event_type_id
    ? await queryOne<EventTypeRow>("SELECT * FROM event_types WHERE id = $1", [booking.event_type_id])
    : null;
  if (eventType?.disable_cancelling) throw forbidden("Cancelling is disabled for this event type");

  await query(
    `UPDATE bookings SET status = 'cancelled', cancellation_reason = $2, cancelled_by_email = $3,
                         updated_at = now()
     WHERE id = $1`,
    [booking.id, input.reason ?? null, actor.email ?? null]
  );

  if (input.cancelSubsequentBookings && booking.recurring_event_uid) {
    await query(
      `UPDATE bookings SET status = 'cancelled', cancellation_reason = $3, updated_at = now()
       WHERE recurring_event_uid = $1 AND start_time > $2 AND status IN ('accepted', 'pending')`,
      [booking.recurring_event_uid, booking.start_time, input.reason ?? null]
    );
  }

  const result = await loadBooking(uid);
  await syncBookingToCalendars(booking.id);
  if (input.cancelSubsequentBookings && booking.recurring_event_uid) {
    const siblings = await query<{ id: number }>(
      "SELECT id FROM bookings WHERE recurring_event_uid = $1 AND start_time > $2",
      [booking.recurring_event_uid, booking.start_time]
    );
    for (const sibling of siblings) await syncBookingToCalendars(sibling.id);
  }
  invalidateBusyCache();
  await dispatchWebhooks(
    "BOOKING_CANCELLED",
    { userId: eventType?.owner_id, teamId: eventType?.team_id, eventTypeId: eventType?.id },
    result
  );
  notifyBookingCancelled(result);
  return result;
}

export async function setBookingStatus(
  uid: string,
  actor: MutationActor,
  status: "accepted" | "rejected",
  reason?: string
) {
  const booking = await findBookingRow(uid);
  await assertBookingAccess(booking, actor);
  if (booking.status !== "pending") throw badRequest("Only pending bookings can be confirmed or declined");

  await query(
    `UPDATE bookings SET status = $2, cancellation_reason = COALESCE($3, cancellation_reason),
                         updated_at = now()
     WHERE id = $1`,
    [booking.id, status, reason ?? null]
  );
  const result = await loadBooking(uid);
  const eventType = booking.event_type_id
    ? await queryOne<EventTypeRow>("SELECT * FROM event_types WHERE id = $1", [booking.event_type_id])
    : null;
  // Confirming adds the event to the hosts' calendars; declining removes it.
  await syncBookingToCalendars(booking.id);
  invalidateBusyCache();
  await dispatchWebhooks(
    status === "accepted" ? "BOOKING_CONFIRMED" : "BOOKING_REJECTED",
    { userId: eventType?.owner_id, teamId: eventType?.team_id, eventTypeId: eventType?.id },
    result
  );
  notifyBookingDecision(result, status === "accepted");
  return result;
}

export async function rescheduleBooking(
  uid: string,
  actor: MutationActor,
  input: { start: Date; reason?: string; lengthInMinutes?: number }
) {
  const booking = await findBookingRow(uid);
  await assertBookingAccess(booking, actor);
  if (booking.status === "cancelled") throw badRequest("Cancelled bookings cannot be rescheduled");
  if (!booking.event_type_id) throw badRequest("This booking has no event type");

  const eventType = await queryOne<EventTypeRow>("SELECT * FROM event_types WHERE id = $1", [
    booking.event_type_id,
  ]);
  if (!eventType) throw notFound("Event type not found");
  if (eventType.disable_rescheduling) throw forbidden("Rescheduling is disabled for this event type");
  if (!eventType.allow_rescheduling_past_bookings && booking.start_time.getTime() < Date.now()) {
    throw badRequest("Past bookings cannot be rescheduled");
  }

  const duration =
    input.lengthInMinutes ??
    Math.round((booking.end_time.getTime() - booking.start_time.getTime()) / 60000);
  const context = await assertSlotFree(eventType, input.start, duration, {
    ignoreBookingUids: [uid],
  });
  const end = new Date(input.start.getTime() + duration * 60000);

  const attendees = await query<BookingAttendeeRow>(
    `SELECT id, booking_id, name, email, time_zone, language, phone_number, no_show, seat_uid, is_guest
     FROM booking_attendees WHERE booking_id = $1 ORDER BY id`,
    [booking.id]
  );
  const primary = attendees.find((attendee) => !attendee.is_guest);

  const newUid = randomUUID();
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO bookings (uid, event_type_id, user_id, booked_by_user_id, title, description,
                             start_time, end_time, status, location, meeting_url,
                             rescheduled_from_uid, rescheduling_reason, rescheduled_by_email,
                             recurring_event_uid, booking_fields_responses, metadata, ics_uid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18)`,
      [
        newUid,
        booking.event_type_id,
        context.primaryHostId,
        actor.userId ?? null,
        booking.title,
        booking.description,
        input.start,
        end,
        booking.status === "pending" ? "pending" : "accepted",
        booking.location,
        booking.meeting_url,
        booking.uid,
        input.reason ?? null,
        actor.email ?? null,
        booking.recurring_event_uid,
        JSON.stringify(booking.booking_fields_responses ?? {}),
        JSON.stringify(booking.metadata ?? {}),
        `${newUid}@cal.local`,
      ]
    );
    const inserted = await tx.queryOne<{ id: number }>("SELECT id FROM bookings WHERE uid = $1", [
      newUid,
    ]);
    for (const hostId of context.hostIds) {
      await tx.query(
        "INSERT INTO booking_hosts (booking_id, user_id, mandatory) VALUES ($1, $2, $3)",
        [inserted!.id, hostId, eventType.scheduling_type === "collective"]
      );
    }
    for (const attendee of attendees) {
      await tx.query(
        `INSERT INTO booking_attendees (booking_id, name, email, time_zone, language, phone_number, is_guest)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          inserted!.id,
          attendee.name,
          attendee.email,
          attendee.time_zone,
          attendee.language,
          attendee.phone_number,
          attendee.is_guest,
        ]
      );
    }
    await tx.query(
      `UPDATE bookings SET status = 'cancelled', rescheduled_to_uid = $2,
                           rescheduling_reason = COALESCE($3, rescheduling_reason), updated_at = now()
       WHERE id = $1`,
      [booking.id, newUid, input.reason ?? null]
    );
  });

  void primary;
  // The old row is now cancelled and the new one takes its place on Google.
  await syncBookingToCalendars(booking.id);
  const moved = await queryOne<{ id: number }>("SELECT id FROM bookings WHERE uid = $1", [newUid]);
  if (moved) await syncBookingToCalendars(moved.id);
  invalidateBusyCache();
  const result = await loadBooking(newUid);
  await dispatchWebhooks(
    "BOOKING_RESCHEDULED",
    { userId: eventType.owner_id, teamId: eventType.team_id, eventTypeId: eventType.id },
    result
  );
  notifyBookingRescheduled(result, booking.start_time);
  return result;
}

export async function requestReschedule(
  uid: string,
  actor: MutationActor,
  reason?: string
) {
  const booking = await findBookingRow(uid);
  await assertBookingAccess(booking, actor);
  await query(
    `UPDATE bookings SET status = 'cancelled', rescheduling_reason = $2,
                         cancellation_reason = 'Reschedule requested', updated_at = now()
     WHERE id = $1`,
    [booking.id, reason ?? null]
  );
  await syncBookingToCalendars(booking.id);
  invalidateBusyCache();
  const result = await loadBooking(uid);
  // The slot is already free at this point, so the mail can honestly ask them
  // to pick a new time rather than warn that one is about to disappear.
  notifyRescheduleRequested(result, actor.email ?? undefined);
  return result;
}

export async function markAbsent(
  uid: string,
  actor: MutationActor,
  input: { host?: boolean; attendees?: Array<{ email: string; absent: boolean }> }
) {
  const booking = await findBookingRow(uid);
  await assertBookingAccess(booking, actor);
  if (input.host !== undefined) {
    await query("UPDATE bookings SET absent_host = $2, updated_at = now() WHERE id = $1", [
      booking.id,
      input.host,
    ]);
  }
  for (const attendee of input.attendees ?? []) {
    await query(
      "UPDATE booking_attendees SET no_show = $3 WHERE booking_id = $1 AND lower(email) = lower($2)",
      [booking.id, attendee.email, attendee.absent]
    );
  }
  return loadBooking(uid);
}

export async function reassignBooking(
  uid: string,
  actor: MutationActor,
  targetUserId?: number
) {
  const booking = await findBookingRow(uid);
  await assertBookingAccess(booking, actor);
  if (!booking.event_type_id) throw badRequest("This booking has no event type");
  const eventType = await queryOne<EventTypeRow>("SELECT * FROM event_types WHERE id = $1", [
    booking.event_type_id,
  ]);
  if (!eventType?.team_id) throw badRequest("Only team bookings can be reassigned");

  let newHostId = targetUserId;
  if (!newHostId) {
    const hostRefs = await resolveHosts(eventType);
    const duration = Math.round(
      (booking.end_time.getTime() - booking.start_time.getTime()) / 60000
    );
    const hosts = await loadHostSchedules(
      hostRefs.filter((host) => host.userId !== booking.user_id),
      eventType,
      { from: booking.start_time, to: booking.end_time, ignoreBookingUids: [uid] }
    );
    const options = await slotOptionsFor(eventType, {
      from: booking.start_time,
      to: booking.end_time,
      durationMinutes: duration,
      ignoreBookingUids: [uid],
    });
    const slot = isSlotBookable(hosts, booking.start_time.getTime(), {
      ...options,
      minimumBookingNotice: 0,
    });
    if (!slot) throw conflict("No other host is available for this slot");
    newHostId = await pickRoundRobinHost(eventType.id, slot.hostIds);
  } else {
    const isHost = await queryOne(
      "SELECT 1 FROM event_type_hosts WHERE event_type_id = $1 AND user_id = $2",
      [eventType.id, newHostId]
    );
    if (!isHost) throw badRequest("That user is not a host of this event type");
  }

  await withTransaction(async (tx) => {
    await tx.query("UPDATE bookings SET user_id = $2, updated_at = now() WHERE id = $1", [
      booking.id,
      newHostId,
    ]);
    await tx.query("DELETE FROM booking_hosts WHERE booking_id = $1", [booking.id]);
    await tx.query("INSERT INTO booking_hosts (booking_id, user_id) VALUES ($1, $2)", [
      booking.id,
      newHostId,
    ]);
  });
  // The event has to leave the previous host's calendar and land on the new one.
  await syncBookingToCalendars(booking.id);
  invalidateBusyCache();
  return loadBooking(uid);
}

export async function updateBookingLocation(
  uid: string,
  actor: MutationActor,
  location: string
) {
  const booking = await findBookingRow(uid);
  await assertBookingAccess(booking, actor);
  await query("UPDATE bookings SET location = $2, updated_at = now() WHERE id = $1", [
    booking.id,
    location,
  ]);
  await syncBookingToCalendars(booking.id);
  return loadBooking(uid);
}

/** Bumps a booking's date by whole days — used by the reschedule dialog preview. */
export function shiftDateISO(dateISO: string, days: number): string {
  return addDaysISO(dateISO, days);
}
