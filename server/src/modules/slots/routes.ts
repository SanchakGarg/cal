import { randomBytes } from "node:crypto";
import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, conflict, notFound } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import { asObject, instant, int, optInt, optStr, paramInt } from "../../http/validate.ts";
import { optionalAuth } from "../../auth/middleware.ts";
import { isValidTimeZone } from "../../lib/tz.ts";
import { generateSlots, groupSlotsByDate } from "../../lib/slots.ts";
import type { EventTypeRow } from "../serialize.ts";
import { findPublicEventType } from "../event-types/repo.ts";
import { loadHostSchedules, resolveHosts, slotOptionsFor } from "../availability/loader.ts";

const MAX_RANGE_DAYS = 370;

export async function resolveEventTypeFromQuery(params: {
  eventTypeId?: number;
  eventTypeSlug?: string;
  username?: string;
  teamSlug?: string;
}): Promise<EventTypeRow> {
  if (params.eventTypeId !== undefined) {
    const row = await queryOne<EventTypeRow>("SELECT * FROM event_types WHERE id = $1", [
      params.eventTypeId,
    ]);
    if (!row) throw notFound("Event type not found");
    return row;
  }
  if (!params.eventTypeSlug || (!params.username && !params.teamSlug)) {
    throw badRequest("Provide eventTypeId, or eventTypeSlug with username or teamSlug");
  }
  const row = await findPublicEventType({
    username: params.username,
    teamSlug: params.teamSlug,
    eventSlug: params.eventTypeSlug,
  });
  if (!row) throw notFound("Event type not found");
  return row;
}

export const slotsRouter: Router = Router();

slotsRouter.get(
  "/",
  optionalAuth,
  handler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const start = instant(optStr(q, "start") ?? "", "start");
    const end = instant(optStr(q, "end") ?? "", "end");
    if (end <= start) throw badRequest("end must be after start");
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400000) {
      throw badRequest(`Range must be at most ${MAX_RANGE_DAYS} days`);
    }

    const eventType = await resolveEventTypeFromQuery({
      eventTypeId: q.eventTypeId === undefined ? undefined : paramInt(q.eventTypeId, "eventTypeId"),
      eventTypeSlug: optStr(q, "eventTypeSlug"),
      username: optStr(q, "username"),
      teamSlug: optStr(q, "teamSlug"),
    });

    const timeZone = optStr(q, "timeZone") ?? "UTC";
    if (!isValidTimeZone(timeZone)) throw badRequest("timeZone must be a valid IANA time zone");

    const duration = q.duration === undefined ? undefined : paramInt(q.duration, "duration");
    if (duration !== undefined) {
      const allowed = [eventType.length_in_minutes, ...(eventType.length_in_minutes_options ?? [])];
      if (!allowed.includes(duration)) {
        throw badRequest(`duration must be one of ${allowed.join(", ")}`);
      }
    }

    const rescheduleUid = optStr(q, "bookingUidToReschedule");
    const hostRefs = await resolveHosts(eventType);
    const hosts = await loadHostSchedules(hostRefs, eventType, {
      from: start,
      to: end,
      ignoreBookingUids: rescheduleUid ? [rescheduleUid] : undefined,
      ignoreReservationUid: optStr(q, "reservationUid"),
    });
    const options = await slotOptionsFor(eventType, {
      from: start,
      to: end,
      durationMinutes: duration,
      limitsTimeZone: hosts[0]?.timeZone ?? timeZone,
      ignoreBookingUids: rescheduleUid ? [rescheduleUid] : undefined,
    });
    const slots = generateSlots(hosts, options);

    const format = optStr(q, "format") ?? "time";
    if (format === "range") {
      const grouped = groupSlotsByDate(slots, timeZone);
      const payload: Record<string, Array<Record<string, unknown>>> = {};
      for (const [date, entries] of Object.entries(grouped)) {
        payload[date] = entries.map((slot) => ({
          start: new Date(slot.start).toISOString(),
          end: new Date(slot.end).toISOString(),
          ...(slot.seatsRemaining !== undefined
            ? { seatsRemaining: slot.seatsRemaining, seatsTotal: slot.seatsTotal }
            : {}),
        }));
      }
      ok(res, payload);
      return;
    }

    const grouped = groupSlotsByDate(slots, timeZone);
    const payload: Record<string, Array<Record<string, unknown>>> = {};
    for (const [date, entries] of Object.entries(grouped)) {
      payload[date] = entries.map((slot) => ({
        start: new Date(slot.start).toISOString(),
        ...(slot.seatsRemaining !== undefined
          ? { seatsRemaining: slot.seatsRemaining, seatsTotal: slot.seatsTotal }
          : {}),
      }));
    }
    ok(res, payload);
  })
);

const RESERVATION_SELECT =
  "uid, event_type_id, slot_start, slot_duration, expires_at, reserved_by";

interface ReservationRow {
  uid: string;
  event_type_id: number;
  slot_start: Date;
  slot_duration: number;
  expires_at: Date;
  reserved_by: number | null;
}

const serializeReservation = (row: ReservationRow) => ({
  reservationUid: row.uid,
  eventTypeId: row.event_type_id,
  slotStart: row.slot_start.toISOString(),
  slotDuration: row.slot_duration,
  reservationDuration: Math.max(
    0,
    Math.round((row.expires_at.getTime() - Date.now()) / 60000)
  ),
  reservationUntil: row.expires_at.toISOString(),
});

slotsRouter.post(
  "/reservations",
  optionalAuth,
  handler(async (req, res) => {
    const body = asObject(req.body);
    const eventTypeId = int(body, "eventTypeId");
    const slotStart = instant(body.slotStart, "slotStart");
    const eventType = await queryOne<EventTypeRow>("SELECT * FROM event_types WHERE id = $1", [
      eventTypeId,
    ]);
    if (!eventType) throw notFound("Event type not found");

    const slotDuration = optInt(body, "slotDuration", { min: 1 }) ?? eventType.length_in_minutes;
    const reservationDuration = optInt(body, "reservationDuration", { min: 1, max: 30 }) ?? 5;

    const taken = await queryOne(
      `SELECT 1 FROM slot_reservations
       WHERE event_type_id = $1 AND slot_start = $2 AND expires_at > now()`,
      [eventTypeId, slotStart]
    );
    if (taken && !eventType.seats_per_time_slot) {
      throw conflict("This slot is already being held by someone else");
    }

    const row = await queryOne<ReservationRow>(
      `INSERT INTO slot_reservations (uid, event_type_id, slot_start, slot_duration, expires_at, reserved_by)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval, $6)
       RETURNING ${RESERVATION_SELECT}`,
      [
        randomBytes(12).toString("base64url"),
        eventTypeId,
        slotStart,
        slotDuration,
        reservationDuration,
        req.user?.id ?? null,
      ]
    );
    ok(res, serializeReservation(row!), 201);
  })
);

slotsRouter.get(
  "/reservations/:uid",
  handler(async (req, res) => {
    const row = await queryOne<ReservationRow>(
      `SELECT ${RESERVATION_SELECT} FROM slot_reservations WHERE uid = $1 AND expires_at > now()`,
      [String(req.params.uid)]
    );
    if (!row) throw notFound("Reservation not found or expired");
    ok(res, serializeReservation(row));
  })
);

slotsRouter.patch(
  "/reservations/:uid",
  handler(async (req, res) => {
    const body = asObject(req.body ?? {});
    const extraMinutes = optInt(body, "reservationDuration", { min: 1, max: 30 }) ?? 5;
    const row = await queryOne<ReservationRow>(
      `UPDATE slot_reservations
       SET expires_at = now() + ($2 || ' minutes')::interval
       WHERE uid = $1 AND expires_at > now()
       RETURNING ${RESERVATION_SELECT}`,
      [String(req.params.uid), extraMinutes]
    );
    if (!row) throw notFound("Reservation not found or expired");
    ok(res, serializeReservation(row));
  })
);

slotsRouter.delete(
  "/reservations/:uid",
  handler(async (req, res) => {
    await query("DELETE FROM slot_reservations WHERE uid = $1", [String(req.params.uid)]);
    ok(res, { reservationUid: String(req.params.uid) });
  })
);
