// Mirrors bookings onto the hosts' linked Google Calendars.
//
// Every entry point is best effort: a Google outage, a revoked grant or a
// rate limit must never turn into a failed booking, so failures are logged and
// the connection is left for the settings page to report.

import { query, queryOne } from "../db/pool.ts";
import { env } from "../env.ts";
import {
  type CalendarConnectionRow,
  accessTokenFor,
  connectionsForConflicts,
  connectionsForSync,
} from "../modules/calendars/repo.ts";
import {
  type BusyInterval,
  type GoogleEventInput,
  deleteEvent,
  freeBusy,
  googleCalendarReady,
  insertEvent,
  updateEvent,
} from "./google.ts";

interface SyncBookingRow {
  id: number;
  uid: string;
  title: string;
  description: string;
  start_time: Date;
  end_time: Date;
  status: string;
  location: string;
  meeting_url: string | null;
  event_type_id: number | null;
  booking_fields_responses: Record<string, unknown> | null;
}

/** The question labels, so answers read as questions rather than as slugs. */
interface BookingFieldMeta {
  slug: string;
  label?: string;
  type?: string;
}

interface SyncedEventRow {
  id: number;
  connection_id: number;
  calendar_id: string;
  event_id: string;
}

async function loadSyncContext(bookingId: number) {
  const booking = await queryOne<SyncBookingRow>(
    `SELECT id, uid, title, description, start_time, end_time, status, location, meeting_url,
            event_type_id, booking_fields_responses
     FROM bookings WHERE id = $1`,
    [bookingId]
  );
  if (!booking) return null;

  const [hosts, attendees, synced, fields] = await Promise.all([
    query<{ user_id: number }>("SELECT user_id FROM booking_hosts WHERE booking_id = $1", [
      bookingId,
    ]),
    query<{ name: string; email: string; is_guest: boolean }>(
      "SELECT name, email, is_guest FROM booking_attendees WHERE booking_id = $1 ORDER BY id",
      [bookingId]
    ),
    query<SyncedEventRow>(
      "SELECT id, connection_id, calendar_id, event_id FROM booking_calendar_events WHERE booking_id = $1",
      [bookingId]
    ),
    booking.event_type_id
      ? queryOne<{ booking_fields: BookingFieldMeta[] | null }>(
          "SELECT booking_fields FROM event_types WHERE id = $1",
          [booking.event_type_id]
        )
      : Promise.resolve(null),
  ]);
  return {
    booking,
    hostIds: hosts.map((host) => host.user_id),
    attendees,
    synced,
    fields: fields?.booking_fields ?? [],
  };
}

/** Fields the booker never fills in themselves, so they are not "answers". */
const SYSTEM_FIELDS = new Set([
  "name",
  "email",
  "location",
  "guests",
  "notes",
  "rescheduleReason",
  "title",
  "splitName",
]);

/** One answer per line, labelled the way the question was asked. */
function answerLines(booking: SyncBookingRow, fields: BookingFieldMeta[]): string[] {
  const responses = booking.booking_fields_responses ?? {};
  const labelFor = new Map(fields.map((field) => [field.slug, field.label || field.slug]));
  const lines: string[] = [];

  for (const [slug, answer] of Object.entries(responses)) {
    if (SYSTEM_FIELDS.has(slug)) continue;
    if (answer === null || answer === undefined || answer === "") continue;
    const text = Array.isArray(answer) ? answer.join(", ") : String(answer);
    if (!text.trim()) continue;
    lines.push(`${labelFor.get(slug) ?? slug}: ${text}`);
  }
  // Notes are a system field but they are still something the booker wrote.
  const notes = responses.notes;
  if (typeof notes === "string" && notes.trim()) lines.push(`Notes: ${notes.trim()}`);
  return lines;
}

function eventInput(
  booking: SyncBookingRow,
  attendees: Array<{ name: string; email: string; is_guest: boolean }>,
  fields: BookingFieldMeta[],
  withMeet: boolean
): GoogleEventInput {
  const sections = [booking.description].filter(Boolean) as string[];

  // The booker is not invited to this event, so the description has to say who
  // it is with — otherwise the calendar entry is a meeting with nobody.
  const who = attendees.filter((attendee) => !attendee.is_guest);
  const guests = attendees.filter((attendee) => attendee.is_guest);
  if (who.length > 0) {
    sections.push(who.map((attendee) => `${attendee.name} (${attendee.email})`).join("\n"));
  }
  if (guests.length > 0) {
    sections.push(`Guests: ${guests.map((guest) => guest.email).join(", ")}`);
  }

  const answers = answerLines(booking, fields);
  if (answers.length > 0) sections.push(answers.join("\n"));

  sections.push(`Booked with Cal — reference ${booking.uid}`);

  return {
    summary: booking.title,
    description: sections.join("\n\n"),
    location: booking.meeting_url || booking.location,
    start: booking.start_time,
    end: booking.end_time,
    // Deliberately nobody: the event is the host's own record of the booking.
    // Cal has already emailed everyone, and adding Google attendees would make
    // Google send its own invitations and cancellations on top.
    attendees: undefined,
    sourceUid: booking.uid,
    createMeetLink: withMeet,
  };
}

async function dropSyncedEvent(
  connection: CalendarConnectionRow,
  synced: SyncedEventRow
): Promise<void> {
  const token = await accessTokenFor(connection);
  if (token) {
    try {
      await deleteEvent(token, synced.calendar_id, synced.event_id);
    } catch (error) {
      // A 404/410 just means it is already gone, which is the outcome we want.
      console.warn(`google calendar delete failed for event ${synced.event_id}:`, error);
    }
  }
  await query("DELETE FROM booking_calendar_events WHERE id = $1", [synced.id]);
}

/** Creates, updates or removes the Google events for a booking so they match
 *  its current state. Safe to call after any booking mutation. */
export async function syncBookingToCalendars(bookingId: number): Promise<void> {
  if (!googleCalendarReady()) return;
  try {
    const context = await loadSyncContext(bookingId);
    if (!context) return;
    const { booking, hostIds, attendees, synced, fields } = context;

    // Only confirmed bookings belong on a calendar; anything else must not.
    const shouldExist = booking.status === "accepted";
    const connections = shouldExist ? await connectionsForSync(hostIds) : [];
    const byId = new Map(connections.map((connection) => [connection.id, connection]));

    for (const row of synced) {
      if (byId.has(row.connection_id)) continue;
      const connection = await queryOne<CalendarConnectionRow>(
        "SELECT * FROM calendar_connections WHERE id = $1",
        [row.connection_id]
      );
      if (connection) await dropSyncedEvent(connection, row);
      else await query("DELETE FROM booking_calendar_events WHERE id = $1", [row.id]);
    }
    if (!shouldExist) return;

    for (const connection of connections) {
      const token = await accessTokenFor(connection);
      if (!token) continue;
      const existing = synced.find((row) => row.connection_id === connection.id);
      try {
        if (existing) {
          // The destination calendar can be changed after the fact; move the
          // event by recreating it rather than patching across calendars.
          if (existing.calendar_id !== connection.calendar_id) {
            await dropSyncedEvent(connection, existing);
          } else {
            await updateEvent(
              token,
              existing.calendar_id,
              existing.event_id,
              eventInput(booking, attendees, fields, false)
            );
            continue;
          }
        }

        const wantsMeet = env.google.createMeetLinks && !booking.meeting_url && !booking.location;
        const event = await insertEvent(
          token,
          connection.calendar_id,
          eventInput(booking, attendees, fields, wantsMeet)
        );
        await query(
          `INSERT INTO booking_calendar_events
             (booking_id, connection_id, calendar_id, event_id, html_link, meeting_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (booking_id, connection_id) DO UPDATE SET
             calendar_id = EXCLUDED.calendar_id,
             event_id    = EXCLUDED.event_id,
             html_link   = EXCLUDED.html_link,
             meeting_url = EXCLUDED.meeting_url`,
          [
            booking.id,
            connection.id,
            connection.calendar_id,
            event.id,
            event.htmlLink ?? null,
            event.hangoutLink ?? null,
          ]
        );
        if (event.hangoutLink && !booking.meeting_url) {
          await query("UPDATE bookings SET meeting_url = $2, updated_at = now() WHERE id = $1", [
            booking.id,
            event.hangoutLink,
          ]);
          booking.meeting_url = event.hangoutLink;
        }
      } catch (error) {
        console.warn(
          `google calendar sync failed for booking ${booking.uid} / connection ${connection.id}:`,
          error
        );
      }
    }
  } catch (error) {
    console.warn(`google calendar sync failed for booking ${bookingId}:`, error);
  }
}

/** Same as sync, addressed by uid — the shape most call sites already hold. */
export async function syncBookingUidToCalendars(uid: string): Promise<void> {
  if (!googleCalendarReady()) return;
  const row = await queryOne<{ id: number }>("SELECT id FROM bookings WHERE uid = $1", [uid]);
  if (row) await syncBookingToCalendars(row.id);
}

/** freeBusy answers are cached briefly: the slots endpoint is polled hard by
 *  the booker page and Google's quota is per project, not per user. */
const busyCache = new Map<string, { at: number; value: BusyInterval[] }>();
const BUSY_TTL_MS = 60_000;

function cacheKey(connectionId: number, from: Date, to: Date): string {
  return `${connectionId}:${from.toISOString()}:${to.toISOString()}`;
}

/** External busy time per user id, for the availability engine. */
export async function externalBusyByUser(
  userIds: number[],
  from: Date,
  to: Date
): Promise<Map<number, BusyInterval[]>> {
  const result = new Map<number, BusyInterval[]>();
  if (!googleCalendarReady() || userIds.length === 0) return result;

  let connections: CalendarConnectionRow[];
  try {
    connections = await connectionsForConflicts(userIds);
  } catch (error) {
    console.warn("could not load calendar connections for conflict checking:", error);
    return result;
  }

  await Promise.all(
    connections.map(async (connection) => {
      const key = cacheKey(connection.id, from, to);
      const cached = busyCache.get(key);
      let intervals: BusyInterval[];
      if (cached && Date.now() - cached.at < BUSY_TTL_MS) {
        intervals = cached.value;
      } else {
        const token = await accessTokenFor(connection);
        if (!token) return;
        try {
          intervals = await freeBusy(token, [connection.calendar_id], from, to);
        } catch (error) {
          console.warn(`google freeBusy failed for connection ${connection.id}:`, error);
          return;
        }
        busyCache.set(key, { at: Date.now(), value: intervals });
        // The window moves with every request, so old keys would accumulate.
        if (busyCache.size > 500) {
          for (const [staleKey, entry] of busyCache) {
            if (Date.now() - entry.at > BUSY_TTL_MS) busyCache.delete(staleKey);
          }
        }
      }
      const existing = result.get(connection.user_id) ?? [];
      existing.push(...intervals);
      result.set(connection.user_id, existing);
    })
  );
  return result;
}

/** Drops cached busy time for a user, so a fresh booking is reflected at once. */
export function invalidateBusyCache(): void {
  busyCache.clear();
}
