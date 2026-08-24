import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TextArea } from "../ui/Field.tsx";
import { Badge, Skeleton } from "../ui/Layout.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking } from "../lib/types.ts";
import { browserTimeZone, formatDateISO, formatTime } from "../lib/time.ts";
import { useRouter } from "../app/router.tsx";
import "./BookingDetailPage.css";

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
          <Skeleton height={200} />
        </div>
      </div>
    );
  }

  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const cancelled = booking.status === "cancelled" || booking.status === "rejected";

  return (
    <div className="cal-booking-detail">
      <div className="cal-card cal-booking-detail__card">
        <div className={`cal-booking-detail__icon ${cancelled ? "is-cancelled" : ""}`}>
          <Icon name={cancelled ? "x" : booking.status === "pending" ? "clock" : "check"} size={22} />
        </div>
        <h1>
          {cancelled
            ? "This booking is cancelled"
            : booking.status === "pending"
              ? "Your booking is awaiting approval"
              : "This meeting is scheduled"}
        </h1>
        <p className="cal-muted">
          {cancelled
            ? "The time has been released."
            : "We sent the details to everyone on the invite."}
        </p>

        <dl className="cal-booking-detail__rows">
          <div>
            <dt>What</dt>
            <dd>{booking.title}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              {formatDateISO(booking.start.slice(0, 10), { weekday: "long" })}
              <br />
              {formatTime(start, timeZone, 12)} – {formatTime(end, timeZone, 12)} ({timeZone})
            </dd>
          </div>
          <div>
            <dt>Who</dt>
            <dd>
              {booking.hosts.map((host) => (
                <span key={host.id} className="cal-booking-detail__person">
                  {host.name} <span className="cal-muted">{host.email}</span> <Badge>Host</Badge>
                </span>
              ))}
              {booking.attendees.map((attendee) => (
                <span key={attendee.email} className="cal-booking-detail__person">
                  {attendee.name} <span className="cal-muted">{attendee.email}</span>
                </span>
              ))}
              {booking.guests.map((guest) => (
                <span key={guest} className="cal-booking-detail__person">
                  <span className="cal-muted">{guest}</span> <Badge>Guest</Badge>
                </span>
              ))}
            </dd>
          </div>
          {booking.location ? (
            <div>
              <dt>Where</dt>
              <dd>{booking.location}</dd>
            </div>
          ) : null}
          {booking.cancellationReason ? (
            <div>
              <dt>Reason</dt>
              <dd>{booking.cancellationReason}</dd>
            </div>
          ) : null}
        </dl>

        {cancelled ? null : (
          <>
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
                <span className="cal-hint">Add to calendar</span>
                <div className="cal-row">
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
          </>
        )}
      </div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this booking?"
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
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Dialog>
    </div>
  );
}
