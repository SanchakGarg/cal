// Booking mail. Every recipient is told the time in their own timezone, so the
// host reads their morning and the attendee reads theirs.
import { buildIcs } from "../../lib/ics.ts";
import {
  bookingCancelledMail,
  bookingConfirmedMail,
  bookingRescheduledMail,
  type BookingMailData,
} from "../../lib/email-templates.ts";
import { sendMailInBackground } from "../../lib/mail.ts";
import { DEFAULT_TIME_ZONE } from "../../lib/tz.ts";
import type { presentBooking } from "./service.ts";

type Booking = Awaited<ReturnType<typeof presentBooking>>;

export interface Recipient {
  email: string;
  name: string;
  timeZone: string;
}

/**
 * Everyone who should hear about a change: the attendees, guests and hosts,
 * de-duplicated by address so a host who booked their own event is mailed once.
 * Exported for testing.
 */
export function mailRecipients(booking: Booking): Recipient[] {
  const seen = new Set<string>();
  const list: Recipient[] = [];

  const add = (email: string | undefined | null, name: string, timeZone: string): void => {
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ email, name, timeZone: timeZone || DEFAULT_TIME_ZONE });
  };

  for (const attendee of booking.attendees) add(attendee.email, attendee.name, attendee.timeZone);
  // Guests gave us an address and nothing else, so they read the organiser's zone.
  const fallbackZone = booking.attendees[0]?.timeZone ?? DEFAULT_TIME_ZONE;
  for (const guest of booking.guests) add(guest, guest, fallbackZone);
  for (const host of booking.hosts) add(host.email, host.name, host.timeZone);

  return list;
}

function mailData(booking: Booking, recipient: Recipient, previousStart?: Date | null): BookingMailData {
  return {
    // `booking.title` reads "Intro call between Ada and Grace", which is right
    // for a calendar entry and wrong for a confirmation addressed to Grace.
    eventName: booking.eventType?.title ?? booking.title,
    description: booking.description,
    start: new Date(booking.start),
    end: new Date(booking.end),
    timeZone: recipient.timeZone,
    location: booking.location,
    meetingUrl: booking.meetingUrl ?? null,
    hosts: booking.hosts.map((host) => ({ name: host.name, email: host.email })),
    uid: booking.uid,
    reason: booking.cancellationReason ?? booking.reschedulingReason ?? null,
    previousStart: previousStart ?? null,
  };
}

/** An .ics so the meeting can be saved straight into any calendar app. */
function invite(booking: Booking): { filename: string; content: string; contentType: string } {
  return {
    filename: "invite.ics",
    contentType: "text/calendar; charset=utf-8; method=REQUEST",
    content: buildIcs({
      uid: booking.icsUid ?? booking.uid,
      title: booking.title,
      description: booking.description ?? "",
      location: booking.location ?? "",
      start: new Date(booking.start),
      end: new Date(booking.end),
      organizerEmail: booking.hosts[0]?.email,
      attendeeEmails: booking.attendees.map((attendee) => attendee.email),
    }),
  };
}

/** A booking was just made — confirmed outright, or awaiting the host. */
export function notifyBookingCreated(booking: Booking): void {
  const pending = booking.status === "pending";
  for (const recipient of mailRecipients(booking)) {
    sendMailInBackground({
      to: recipient.email,
      ...bookingConfirmedMail(mailData(booking, recipient), pending),
      // Nothing to add to a calendar until the host says yes.
      attachments: pending ? undefined : [invite(booking)],
    });
  }
}

/** A pending booking was accepted or rejected by the host. */
export function notifyBookingDecision(booking: Booking, accepted: boolean): void {
  for (const recipient of mailRecipients(booking)) {
    const data = mailData(booking, recipient);
    sendMailInBackground(
      accepted
        ? { to: recipient.email, ...bookingConfirmedMail(data, false), attachments: [invite(booking)] }
        : { to: recipient.email, ...bookingCancelledMail(data, true) }
    );
  }
}

export function notifyBookingRescheduled(booking: Booking, previousStart: Date | null): void {
  for (const recipient of mailRecipients(booking)) {
    sendMailInBackground({
      to: recipient.email,
      ...bookingRescheduledMail(mailData(booking, recipient, previousStart)),
      attachments: [invite(booking)],
    });
  }
}

export function notifyBookingCancelled(booking: Booking): void {
  for (const recipient of mailRecipients(booking)) {
    sendMailInBackground({
      to: recipient.email,
      ...bookingCancelledMail(mailData(booking, recipient), false),
    });
  }
}
