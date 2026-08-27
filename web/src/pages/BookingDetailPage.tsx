import { useEffect, useState } from "react";
import { m } from "motion/react";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TextArea } from "../ui/Field.tsx";
import { Avatar, Badge, Skeleton } from "../ui/Layout.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking } from "../lib/types.ts";
import { browserTimeZone, formatDateISO, formatTime } from "../lib/time.ts";
import { useRouter } from "../app/router.tsx";
import "./BookingDetailPage.css";

/**
 * The card arrives as one piece, then its contents settle in order. `m` needs a
 * MotionConfig ancestor to supply features, which `App` provides; reduced-motion
 * is honoured there too, which collapses these to plain fades.
 */
const CARD = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  shown: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 260, damping: 26, staggerChildren: 0.05 },
  },
};

const ITEM = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const } },
};

/** One field of a date, with no other field implied. */
function datePart(iso: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...options,
  });
}

export function BookingDetailPage({ uid }: { uid: string }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [links, setLinks] = useState<Record<string, string> | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const timeZone = browserTimeZone();

  const load = async (): Promise<void> => {
    try {
      const data = await api.get<Booking>(`/v2/bookings/${uid}`, undefined, { auth: false });
      setBooking(data);
      setLinks(
        await api
          .get<Record<string, string>>(`/v2/bookings/${uid}/calendar-links`, undefined, { auth: false })
          .catch(() => null)
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const cancel = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post(
        `/v2/bookings/${uid}/cancel`,
        { cancellationReason: reason || undefined, email: booking?.attendees[0]?.email },
        { auth: false }
      );
      setCancelOpen(false);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!booking) {
    return (
      <div className="cal-booking-detail">
        <div className="cal-card cal-booking-detail__card">
          <Skeleton height={260} />
        </div>
      </div>
    );
  }

  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const cancelled = booking.status === "cancelled" || booking.status === "rejected";
  const pending = booking.status === "pending";
  const noShowAttendees = booking.attendees.filter((attendee) => attendee.absent);
  const tone = cancelled ? "cancelled" : pending ? "pending" : "confirmed";

  const people = [
    ...booking.hosts.map((host) => ({
      key: `host-${host.id}`,
      name: host.name,
      detail: host.email,
      colorKey: host.email,
      tag: "Host",
      absent: booking.absentHost,
    })),
    ...booking.attendees.map((attendee) => ({
      key: `attendee-${attendee.email}`,
      name: attendee.name,
      detail: attendee.email,
      colorKey: attendee.email,
      tag: null,
      absent: attendee.absent,
    })),
    ...booking.guests.map((guest) => ({
      key: `guest-${guest}`,
      name: guest,
      detail: null,
      colorKey: guest,
      tag: "Guest",
      absent: false,
    })),
  ];

  return (
    <div className="cal-booking-detail">
      <m.div
        className={`cal-booking-detail__card is-${tone}`}
        initial="hidden"
        animate="shown"
        variants={CARD}
      >
        <m.div className="cal-booking-detail__banner" variants={ITEM}>
          <span className="cal-booking-detail__icon">
            <Icon name={cancelled ? "x" : pending ? "clock" : "check"} size={20} />
          </span>
          <div>
            <p className="cal-eyebrow">
              {cancelled
                ? booking.status === "rejected"
                  ? "Declined"
                  : "Cancelled"
                : pending
                  ? "Awaiting approval"
                  : "Confirmed"}
            </p>
            <h1>
              {cancelled
                ? "This booking is cancelled"
                : pending
                  ? "Your booking is awaiting approval"
                  : "This meeting is scheduled"}
            </h1>
          </div>
        </m.div>

        <m.div className="cal-booking-detail__body" variants={ITEM}>
          {/* The date is the answer most people opened this page for, so it gets
              the largest type on the card rather than a row in a list. */}
          <m.div className="cal-booking-detail__when" variants={ITEM}>
            <div className="cal-booking-detail__date" aria-hidden="true">
              <span className="cal-booking-detail__weekday">{datePart(booking.start, { weekday: "short" })}</span>
              <span className="cal-booking-detail__day">{datePart(booking.start, { day: "numeric" })}</span>
              <span className="cal-booking-detail__month">{datePart(booking.start, { month: "short" })}</span>
            </div>
            <div className="cal-booking-detail__when-text">
              <p className="cal-booking-detail__title">{booking.title}</p>
              <p className="cal-booking-detail__full-date">
                {formatDateISO(booking.start.slice(0, 10), { weekday: "long" })}
              </p>
              <p className="cal-booking-detail__time cal-num">
                {formatTime(start, timeZone, 12)} – {formatTime(end, timeZone, 12)}
              </p>
              <p className="cal-hint">{timeZone}</p>
            </div>
          </m.div>

          {(booking.absentHost || noShowAttendees.length > 0) && (
            <m.div className="cal-booking-detail__flags" variants={ITEM}>
              {booking.absentHost ? <Badge tone="error">Host did not attend</Badge> : null}
              {noShowAttendees.length > 0 ? (
                <Badge tone="error">
                  {noShowAttendees.length === 1
                    ? `${noShowAttendees[0].name} did not attend`
                    : `${noShowAttendees.length} attendees did not attend`}
                </Badge>
              ) : null}
            </m.div>
          )}

          <m.div className="cal-booking-detail__people" variants={ITEM}>
            {people.map((person) => (
              <div key={person.key} className="cal-booking-detail__person">
                <Avatar name={person.name} size={28} colorKey={person.colorKey} />
                <span className="cal-booking-detail__person-text">
                  <span className="cal-row">
                    <strong>{person.name}</strong>
                    {person.tag ? <Badge>{person.tag}</Badge> : null}
                    {person.absent ? <Badge tone="error">Did not attend</Badge> : null}
                  </span>
                  {person.detail ? <span className="cal-hint">{person.detail}</span> : null}
                </span>
              </div>
            ))}
          </m.div>

          {booking.location ? (
            <m.div className="cal-booking-detail__row" variants={ITEM}>
              <Icon name="mapPin" size={15} />
              <span>{booking.location}</span>
            </m.div>
          ) : null}

          {booking.meetingUrl && !cancelled ? (
            <m.div className="cal-booking-detail__row" variants={ITEM}>
              <Icon name="video" size={15} />
              <a href={booking.meetingUrl} target="_blank" rel="noreferrer">
                Join the meeting
              </a>
            </m.div>
          ) : null}

          {booking.cancellationReason ? (
            <m.div className="cal-booking-detail__note" variants={ITEM}>
              <p className="cal-eyebrow">Reason</p>
              <p>{booking.cancellationReason}</p>
              {booking.cancelledByEmail ? (
                <p className="cal-hint">Cancelled by {booking.cancelledByEmail}</p>
              ) : null}
            </m.div>
          ) : null}

          {cancelled ? (
            <m.p className="cal-hint" variants={ITEM}>
              The time has been released, so it is bookable again.
            </m.p>
          ) : null}
        </m.div>

        {cancelled ? null : (
          <m.div className="cal-booking-detail__footer" variants={ITEM}>
            <div className="cal-booking-detail__actions">
              <Button variant="secondary" onClick={() => navigate(`/reschedule/${booking.uid}`)}>
                Reschedule
              </Button>
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            </div>
            {links ? (
              <div className="cal-booking-detail__calendar">
                <span className="cal-eyebrow">Add to calendar</span>
                <div className="cal-booking-detail__calendar-links">
                  <a href={links.google} target="_blank" rel="noreferrer">
                    Google
                  </a>
                  <a href={links.microsoftOutlook} target="_blank" rel="noreferrer">
                    Outlook
                  </a>
                  <a href={links.ics} download={`${booking.uid}.ics`}>
                    ICS
                  </a>
                </div>
              </div>
            ) : null}
          </m.div>
        )}
      </m.div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this booking?"
        description="The slot is released and everyone on the invite is told."
        footer={
          <>
            <Button variant="minimal" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" loading={busy} onClick={() => void cancel()}>
              Cancel booking
            </Button>
          </>
        }
      >
        <TextArea
          label="Reason (optional)"
          placeholder="Let them know why, if you like."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Dialog>
    </div>
  );
}
