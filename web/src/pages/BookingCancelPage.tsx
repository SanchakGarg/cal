// Cancelling from the bookings list is a page, not a modal, so the meeting being
// cancelled stays on screen while the reason is written.
import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { TextArea } from "../ui/Field.tsx";
import { Avatar, Badge, PageHeader, Skeleton } from "../ui/Layout.tsx";
import { Alert } from "../ui/Alert.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking } from "../lib/types.ts";
import { formatDateTime, formatTime } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./CreatePages.css";

export function BookingCancelPage({ uid }: { uid: string }) {
  const { me } = useAuth();
  const timeFormat = useTimeFormat();
  const { navigate } = useRouter();
  const toast = useToast();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [missing, setMissing] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .get<Booking>(`/v2/bookings/${uid}`)
      .then(setBooking)
      .catch((error) => {
        toast.error(errorMessage(error));
        setMissing(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const cancel = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.post(`/v2/bookings/${uid}/cancel`, {
        cancellationReason: reason.trim() || undefined,
      });
      toast.success("Booking cancelled", { description: "The attendee has been notified." });
      navigate("/bookings/cancelled");
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  if (missing) {
    return (
      <div className="cal-form-page">
        <PageHeader title="Cancel booking" onBack={() => navigate("/bookings/upcoming")} />
        <Alert tone="error" title="This booking could not be loaded">
          It may already be cancelled, or you may not have access to it.
        </Alert>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="cal-form-page">
        <PageHeader title="Cancel booking" onBack={() => navigate("/bookings/upcoming")} />
        <div className="cal-card cal-form-page__card">
          <Skeleton height={180} />
        </div>
      </div>
    );
  }

  const timeZone = me?.timeZone ?? "UTC";
  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const alreadyCancelled = booking.status === "cancelled" || booking.status === "rejected";

  return (
    <div className="cal-form-page">
      <PageHeader
        title="Cancel this booking?"
        subtitle="The attendee is notified that the meeting is off."
        onBack={() => navigate("/bookings/upcoming")}
      />

      <div className="cal-card cal-form-page__card">
        <dl className="cal-form-page__summary">
          <dt>What</dt>
          <dd>{booking.title}</dd>
          <dt>When</dt>
          <dd>
            {formatDateTime(start, timeZone, timeFormat)} · {formatTime(start, timeZone, timeFormat)} –{" "}
            {formatTime(end, timeZone, timeFormat)}
          </dd>
          {booking.attendees[0] ? (
            <>
              <dt>Who</dt>
              <dd>
                <span className="cal-row">
                  <Avatar
                    name={booking.attendees[0].name}
                    size={20}
                    colorKey={booking.attendees[0].email}
                  />
                  {booking.attendees[0].name} · {booking.attendees[0].email}
                </span>
              </dd>
            </>
          ) : null}
          {booking.location ? (
            <>
              <dt>Where</dt>
              <dd>{booking.location}</dd>
            </>
          ) : null}
        </dl>

        {alreadyCancelled ? (
          <Alert tone="warning" title="This booking is already cancelled">
            <Badge tone="error">{booking.status}</Badge>
            {booking.cancellationReason ? ` Reason: ${booking.cancellationReason}` : null}
          </Alert>
        ) : (
          <TextArea
            label="Reason (optional)"
            placeholder="Let them know why, so they can rebook if it helps."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}

        <div className="cal-form-page__footer">
          <Button variant="minimal" onClick={() => navigate("/bookings/upcoming")}>
            Keep it
          </Button>
          <div className="cal-spacer" />
          <Button
            variant="destructive"
            loading={saving}
            disabled={alreadyCancelled}
            onClick={() => void cancel()}
          >
            Cancel booking
          </Button>
        </div>
      </div>
    </div>
  );
}
