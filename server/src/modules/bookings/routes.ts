import { randomInt } from "node:crypto";
import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, notFound } from "../../http/errors.ts";
import { handler, ok, okPaginated } from "../../http/respond.ts";
import {
  asObject,
  array,
  instant,
  optBool,
  optInt,
  optStr,
  optTimeZone,
  paramInt,
  str,
} from "../../http/validate.ts";
import { currentUser, optionalAuth, requireAuth } from "../../auth/middleware.ts";
import { env } from "../../env.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import { calendarLinks } from "../../lib/ics.ts";
import type { BookingRow, EventTypeRow } from "../serialize.ts";
import { resolveEventTypeFromQuery } from "../slots/routes.ts";
import {
  type AttendeeInput,
  assertBookingAccess,
  loadBookingRow,
  cancelBooking,
  createBooking,
  loadBooking,
  markAbsent,
  presentBooking,
  reassignBooking,
  requestReschedule,
  rescheduleBooking,
  setBookingStatus,
  updateBookingLocation,
} from "./service.ts";

const BOOKING_COLUMNS = `
  id, uid, event_type_id, user_id, title, description, start_time, end_time, status, location,
  meeting_url, cancellation_reason, cancelled_by_email, rescheduling_reason, rescheduled_by_email,
  rescheduled_from_uid, rescheduled_to_uid, recurring_event_uid, absent_host, ics_uid, rating,
  booking_fields_responses, metadata, created_at, updated_at`;

function parseAttendee(raw: unknown): AttendeeInput {
  const attendee = asObject(raw, "attendee");
  return {
    name: str(attendee, "name", { max: 120 }),
    email: str(attendee, "email", { max: 200 }),
    timeZone: optTimeZone(attendee, "timeZone") ?? "UTC",
    language: optStr(attendee, "language", { max: 10 }),
    phoneNumber: optStr(attendee, "phoneNumber", { max: 40 }),
  };
}

function parseLocationInput(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") return raw;
  const location = asObject(raw, "location");
  const type = String(location.type ?? "");
  switch (type) {
    case "integration":
      return String(location.integration ?? "");
    case "link":
      return String(location.link ?? "");
    case "address":
    case "attendeeAddress":
      return String(location.address ?? "");
    case "phone":
    case "attendeePhone":
      return String(location.phone ?? "");
    case "attendeeDefined":
      return String(location.location ?? "");
    default:
      return type || undefined;
  }
}

async function requireVerifiedEmail(eventType: EventTypeRow, email: string, code?: string): Promise<void> {
  if (!eventType.requires_booker_email_verification) return;
  const already = await queryOne("SELECT 1 FROM verified_emails WHERE lower(email) = lower($1)", [
    email,
  ]);
  if (already) return;
  if (!code) throw badRequest("This event type requires email verification; send a code first");
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM email_verification_codes
     WHERE lower(email) = lower($1) AND code = $2 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY id DESC LIMIT 1`,
    [email, code]
  );
  if (!row) throw badRequest("Invalid or expired verification code");
  await query("UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1", [row.id]);
  await query("INSERT INTO verified_emails (email) VALUES ($1)", [email]);
}

// Unauthenticated endpoints that send or check codes for an arbitrary email.
const verificationLimiter = rateLimit({ limit: 5, windowMs: 60_000, name: "verification code" });
const bookingCreateLimiter = rateLimit({ limit: 20, windowMs: 60_000, name: "booking" });

export const bookingsRouter: Router = Router();

bookingsRouter.post(
  "/",
  bookingCreateLimiter,
  optionalAuth,
  handler(async (req, res) => {
    const body = asObject(req.body);
    const start = instant(body.start, "start");
    const eventType = await resolveEventTypeFromQuery({
      eventTypeId: body.eventTypeId === undefined ? undefined : paramInt(body.eventTypeId, "eventTypeId"),
      eventTypeSlug: optStr(body, "eventTypeSlug"),
      username: optStr(body, "username"),
      teamSlug: optStr(body, "teamSlug"),
    });

    const attendee = parseAttendee(body.attendee);
    await requireVerifiedEmail(eventType, attendee.email, optStr(body, "emailVerificationCode"));

    const guests = (body.guests === undefined ? [] : array(body, "guests")).map((guest, index) => {
      if (typeof guest !== "string" || !guest.includes("@")) {
        throw badRequest(`guests[${index}] must be an email address`);
      }
      return guest;
    });

    const responses = body.bookingFieldsResponses
      ? (asObject(body.bookingFieldsResponses, "bookingFieldsResponses") as Record<string, unknown>)
      : {};

    const booking = await createBooking({
      start,
      eventType,
      attendee,
      guests,
      lengthInMinutes: optInt(body, "lengthInMinutes", { min: 1 }),
      location: parseLocationInput(body.location),
      meetingUrl: optStr(body, "meetingUrl", { max: 500 }),
      metadata: body.metadata ? (asObject(body.metadata, "metadata") as Record<string, unknown>) : {},
      bookingFieldsResponses: responses,
      bookedByUserId: req.user?.id ?? null,
      recurrenceCount: optInt(body, "recurrenceCount", { min: 1 }),
      reservationUid: optStr(body, "reservationUid"),
    });
    ok(res, booking, 201);
  })
);

bookingsRouter.get(
  "/",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const q = req.query as Record<string, unknown>;
    const status = optStr(q, "status");
    const conditions: string[] = [
      `(b.user_id = $1 OR b.booked_by_user_id = $1 OR EXISTS (
         SELECT 1 FROM booking_hosts bh WHERE bh.booking_id = b.id AND bh.user_id = $1))`,
    ];
    const params: unknown[] = [user.id];
    const push = (clause: string, value: unknown): void => {
      params.push(value);
      conditions.push(clause.replace("$?", `$${params.length}`));
    };

    switch (status) {
      case "upcoming":
        conditions.push("b.status IN ('accepted', 'pending') AND b.end_time >= now()");
        break;
      case "past":
        conditions.push("b.status <> 'cancelled' AND b.end_time < now()");
        break;
      case "cancelled":
        conditions.push("b.status IN ('cancelled', 'rejected')");
        break;
      case "unconfirmed":
        conditions.push("b.status = 'pending' AND b.end_time >= now()");
        break;
      case "recurring":
        conditions.push("b.recurring_event_uid IS NOT NULL AND b.status <> 'cancelled'");
        break;
      default:
        break;
    }

    if (q.attendeeEmail) {
      push(
        `EXISTS (SELECT 1 FROM booking_attendees a WHERE a.booking_id = b.id AND lower(a.email) = lower($?))`,
        String(q.attendeeEmail)
      );
    }
    if (q.attendeeName) {
      push(
        `EXISTS (SELECT 1 FROM booking_attendees a WHERE a.booking_id = b.id AND a.name ILIKE '%' || $? || '%')`,
        String(q.attendeeName)
      );
    }
    if (q.eventTypeId) push("b.event_type_id = $?", paramInt(q.eventTypeId, "eventTypeId"));
    if (q.eventTypeIds) {
      push(
        "b.event_type_id = ANY($?::int[])",
        String(q.eventTypeIds).split(",").map((value) => paramInt(value, "eventTypeIds"))
      );
    }
    if (q.teamId) {
      push(
        "b.event_type_id IN (SELECT id FROM event_types WHERE team_id = $?)",
        paramInt(q.teamId, "teamId")
      );
    }
    if (q.bookingUid) push("b.uid = $?", String(q.bookingUid));
    if (q.afterStart) push("b.start_time >= $?", instant(q.afterStart, "afterStart"));
    if (q.beforeEnd) push("b.end_time <= $?", instant(q.beforeEnd, "beforeEnd"));
    if (q.afterCreatedAt) push("b.created_at >= $?", instant(q.afterCreatedAt, "afterCreatedAt"));
    if (q.beforeCreatedAt) push("b.created_at <= $?", instant(q.beforeCreatedAt, "beforeCreatedAt"));

    const sortDirection = (value: unknown): "ASC" | "DESC" =>
      String(value).toLowerCase() === "desc" ? "DESC" : "ASC";
    const order: string[] = [];
    if (q.sortStart) order.push(`b.start_time ${sortDirection(q.sortStart)}`);
    if (q.sortEnd) order.push(`b.end_time ${sortDirection(q.sortEnd)}`);
    if (q.sortCreated) order.push(`b.created_at ${sortDirection(q.sortCreated)}`);
    if (order.length === 0) {
      order.push(status === "past" || status === "cancelled" ? "b.start_time DESC" : "b.start_time ASC");
    }

    const limit = Math.min(optInt(q, "limit", { min: 1, max: 250 }) ?? 100, 250);
    const cursor = optInt(q, "cursor", { min: 0 });
    if (cursor !== undefined) push("b.id > $?", cursor);

    const rows = await query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS.replace(/\s+/g, " ").split(", ").map((column) => `b.${column.trim()}`).join(", ")}
       FROM bookings b
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${order.join(", ")}
       LIMIT ${limit + 1}`,
      params
    );

    const page = rows.slice(0, limit);
    const bookings = await Promise.all(page.map(presentBooking));
    okPaginated(res, bookings, {
      hasNextPage: rows.length > limit,
      nextCursor: rows.length > limit ? String(page[page.length - 1]?.id ?? "") : null,
    });
  })
);

bookingsRouter.post(
  "/verification/email/send-code",
  verificationLimiter,
  handler(async (req, res) => {
    const body = asObject(req.body);
    const email = str(body, "email", { max: 200 });
    const code = String(randomInt(100000, 999999));
    await query(
      `INSERT INTO email_verification_codes (email, code, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      [email, code]
    );
    // No mail transport in this build, so the code only reaches the server log.
    // Returning it in the response would make the whole check pointless, so that
    // happens only behind an explicit opt-in flag.
    console.log(`[verification] ${email} -> ${code}`);
    ok(res, {
      sent: true,
      email,
      ...(env.exposeVerificationCodes ? { devCode: code } : {}),
    });
  })
);

bookingsRouter.post(
  "/verification/email/verify-code",
  verificationLimiter,
  handler(async (req, res) => {
    const body = asObject(req.body);
    const email = str(body, "email", { max: 200 });
    const code = str(body, "code", { max: 10 });
    const row = await queryOne<{ id: number }>(
      `SELECT id FROM email_verification_codes
       WHERE lower(email) = lower($1) AND code = $2 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY id DESC LIMIT 1`,
      [email, code]
    );
    if (!row) throw badRequest("Invalid or expired verification code");
    await query("UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1", [row.id]);
    await query("INSERT INTO verified_emails (email) VALUES ($1)", [email]);
    ok(res, { verified: true, email });
  })
);

bookingsRouter.get(
  "/verification/email/check",
  handler(async (req, res) => {
    const email = optStr(req.query as Record<string, unknown>, "email");
    if (!email) throw badRequest("email is required");
    const row = await queryOne("SELECT 1 FROM verified_emails WHERE lower(email) = lower($1)", [email]);
    ok(res, { verified: Boolean(row) });
  })
);

bookingsRouter.get(
  "/:bookingUid",
  optionalAuth,
  handler(async (req, res) => {
    ok(res, await loadBooking(String(req.params.bookingUid)));
  })
);

bookingsRouter.get(
  "/:bookingUid/calendar-links",
  handler(async (req, res) => {
    const booking = await loadBooking(String(req.params.bookingUid));
    ok(
      res,
      calendarLinks({
        uid: booking.uid,
        title: booking.title,
        description: booking.description,
        location: booking.location,
        start: new Date(booking.start),
        end: new Date(booking.end),
        organizerEmail: booking.hosts[0]?.email,
        attendeeEmails: booking.attendees.map((attendee) => attendee.email),
      })
    );
  })
);

function actorFrom(req: Parameters<typeof optionalAuth>[0], body: Record<string, unknown>) {
  return {
    userId: req.user?.id ?? null,
    email: req.user?.email ?? optStr(body, "cancelledBy") ?? optStr(body, "email") ?? null,
  };
}

bookingsRouter.post(
  "/:bookingUid/cancel",
  optionalAuth,
  handler(async (req, res) => {
    const body = asObject(req.body ?? {});
    ok(
      res,
      await cancelBooking(String(req.params.bookingUid), actorFrom(req, body), {
        reason: optStr(body, "cancellationReason", { max: 1000 }),
        cancelSubsequentBookings: optBool(body, "cancelSubsequentBookings"),
      })
    );
  })
);

bookingsRouter.post(
  "/:bookingUid/confirm",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    ok(res, await setBookingStatus(String(req.params.bookingUid), { userId: user.id, email: user.email }, "accepted"));
  })
);

bookingsRouter.post(
  "/:bookingUid/decline",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body ?? {});
    ok(
      res,
      await setBookingStatus(
        String(req.params.bookingUid),
        { userId: user.id, email: user.email },
        "rejected",
        optStr(body, "reason", { max: 1000 })
      )
    );
  })
);

bookingsRouter.post(
  "/:bookingUid/reschedule",
  optionalAuth,
  handler(async (req, res) => {
    const body = asObject(req.body);
    ok(
      res,
      await rescheduleBooking(String(req.params.bookingUid), actorFrom(req, body), {
        start: instant(body.start, "start"),
        reason: optStr(body, "reschedulingReason", { max: 1000 }),
        lengthInMinutes: optInt(body, "lengthInMinutes", { min: 1 }),
      })
    );
  })
);

bookingsRouter.post(
  "/:bookingUid/request-reschedule",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body ?? {});
    ok(
      res,
      await requestReschedule(
        String(req.params.bookingUid),
        { userId: user.id, email: user.email },
        optStr(body, "reason", { max: 1000 })
      )
    );
  })
);

bookingsRouter.post(
  "/:bookingUid/mark-absent",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body ?? {});
    const attendees = (body.attendees === undefined ? [] : array(body, "attendees")).map(
      (entry, index) => {
        const attendee = asObject(entry, `attendees[${index}]`);
        return {
          email: str(attendee, "email", { max: 200 }),
          absent: optBool(attendee, "absent") ?? true,
        };
      }
    );
    ok(
      res,
      await markAbsent(
        String(req.params.bookingUid),
        { userId: user.id, email: user.email },
        { host: optBool(body, "host"), attendees }
      )
    );
  })
);

bookingsRouter.post(
  "/:bookingUid/reassign",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    ok(res, await reassignBooking(String(req.params.bookingUid), { userId: user.id, email: user.email }));
  })
);

bookingsRouter.post(
  "/:bookingUid/reassign/:userId",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    ok(
      res,
      await reassignBooking(
        String(req.params.bookingUid),
        { userId: user.id, email: user.email },
        paramInt(req.params.userId, "userId")
      )
    );
  })
);

bookingsRouter.patch(
  "/:bookingUid/location",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body);
    const location = parseLocationInput(body.location) ?? optStr(body, "location");
    if (!location) throw badRequest("location is required");
    ok(res, await updateBookingLocation(String(req.params.bookingUid), { userId: user.id, email: user.email }, location));
  })
);

bookingsRouter.get(
  "/:bookingUid/attendees",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const row = await loadBookingRow(String(req.params.bookingUid));
    await assertBookingAccess(row, { userId: user.id, email: user.email });
    const booking = await loadBooking(String(req.params.bookingUid));
    ok(res, booking.attendees);
  })
);

bookingsRouter.post(
  "/:bookingUid/guests",
  optionalAuth,
  handler(async (req, res) => {
    const body = asObject(req.body);
    const guests = array(body, "guests", { required: true }).map((guest, index) => {
      if (typeof guest !== "string" || !guest.includes("@")) {
        throw badRequest(`guests[${index}] must be an email address`);
      }
      return guest;
    });
    if (guests.length > 20) throw badRequest("At most 20 guests can be added at once");

    const booking = await loadBookingRow(String(req.params.bookingUid));
    await assertBookingAccess(booking, actorFrom(req, body));

    const row = await queryOne<{ id: number; time_zone: string }>(
      `SELECT b.id, COALESCE(a.time_zone, 'UTC') AS time_zone
       FROM bookings b
       LEFT JOIN booking_attendees a ON a.booking_id = b.id AND a.is_guest = FALSE
       WHERE b.uid = $1 LIMIT 1`,
      [String(req.params.bookingUid)]
    );
    if (!row) throw notFound("Booking not found");
    for (const guest of guests) {
      await query(
        `INSERT INTO booking_attendees (booking_id, name, email, time_zone, is_guest)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [row.id, guest.split("@")[0], guest, row.time_zone]
      );
    }
    ok(res, await loadBooking(String(req.params.bookingUid)));
  })
);

bookingsRouter.get(
  "/by-seat/:seatUid",
  handler(async (req, res) => {
    const row = await queryOne<{ uid: string }>(
      `SELECT b.uid FROM bookings b
       JOIN booking_attendees a ON a.booking_id = b.id
       WHERE a.seat_uid = $1`,
      [String(req.params.seatUid)]
    );
    if (!row) throw notFound("Seat not found");
    ok(res, await loadBooking(row.uid));
  })
);
