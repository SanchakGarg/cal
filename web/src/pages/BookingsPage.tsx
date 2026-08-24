import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { ConfirmDialog, Dialog } from "../ui/Dialog.tsx";
import { TextArea } from "../ui/Field.tsx";
import { Avatar, Badge, EmptyState, List, ListRow, PageHeader, Skeleton, Tabs } from "../ui/Layout.tsx";
import { DropdownMenu, Popover } from "../ui/Popover.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking } from "../lib/types.ts";
import { formatDateTime, formatTime } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./BookingsPage.css";

export type BookingStatus = "upcoming" | "unconfirmed" | "recurring" | "past" | "cancelled";

const TABS: Array<{ value: BookingStatus; label: string }> = [
  { value: "upcoming", label: "Upcoming" },
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "recurring", label: "Recurring" },
  { value: "past", label: "Past" },
  { value: "cancelled", label: "Canceled" },
];

export function BookingsPage({ status }: { status: BookingStatus }) {
  const { me } = useAuth();
  const timeFormat = useTimeFormat();
  const { navigate } = useRouter();
  const toast = useToast();

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    setBookings(null);
    try {
      setBookings(await api.get<Booking[]>("/v2/bookings", { status, limit: 100 }));
    } catch (error) {
      toast.error(errorMessage(error));
      setBookings([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const act = async (booking: Booking, action: "confirm" | "decline" | "mark-absent" | "request-reschedule"): Promise<void> => {
    try {
      await api.post(`/v2/bookings/${booking.uid}/${action}`, action === "mark-absent" ? { host: true } : {});
      toast.success("Booking updated");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const cancel = async (): Promise<void> => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await api.post(`/v2/bookings/${cancelTarget.uid}/cancel`, {
        cancellationReason: cancelReason || undefined,
      });
      toast.success("Booking cancelled");
      setCancelTarget(null);
      setCancelReason("");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const timeZone = me?.timeZone ?? "UTC";

  return (
    <>
      <PageHeader title="Bookings" subtitle="See upcoming and past events booked through your links." />
      <Tabs tabs={TABS} value={status} onChange={(next) => navigate(`/bookings/${next}`)} />

      <div className="cal-bookings">
        {bookings === null ? (
          <List>
            {[0, 1, 2].map((index) => (
              <ListRow key={index}>
                <Skeleton height={52} />
              </ListRow>
            ))}
          </List>
        ) : bookings.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={`No ${status} bookings`}
            description="Bookings made through your event links show up here."
          />
        ) : (
          <List>
            {bookings.map((booking) => {
              const start = new Date(booking.start);
              const end = new Date(booking.end);
              const attendee = booking.attendees[0];
              return (
                <ListRow key={booking.uid}>
                  <div className="cal-booking__when">
                    <strong>{formatDateTime(start, timeZone, timeFormat)}</strong>
                    <span className="cal-hint">
                      {formatTime(start, timeZone, timeFormat)} – {formatTime(end, timeZone, timeFormat)}
                    </span>
                  </div>

                  <div className="cal-booking__what">
                    <div className="cal-row">
                      <strong>{booking.title}</strong>
                      {booking.status === "pending" ? <Badge tone="attention">Unconfirmed</Badge> : null}
                      {booking.status === "cancelled" ? <Badge tone="error">Cancelled</Badge> : null}
                      {booking.status === "rejected" ? <Badge tone="error">Rejected</Badge> : null}
                      {booking.recurringEventUid ? <Badge startIcon="refresh">Recurring</Badge> : null}
                    </div>
                    {attendee ? (
                      <div className="cal-row cal-booking__attendee">
                        <Avatar name={attendee.name} size={20} />
                        <span className="cal-hint">
                          {attendee.name} · {attendee.email}
                        </span>
                      </div>
                    ) : null}
                    {booking.location ? <p className="cal-hint">{booking.location}</p> : null}
                    {booking.cancellationReason ? (
                      <p className="cal-hint">Reason: {booking.cancellationReason}</p>
                    ) : null}
                  </div>

                  <div className="cal-row cal-booking__actions">
                    {booking.status === "pending" ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => void act(booking, "decline")}>
                          Reject
                        </Button>
                        <Button size="sm" onClick={() => void act(booking, "confirm")}>
                          Confirm
                        </Button>
                      </>
                    ) : null}
                    {status === "upcoming" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/reschedule/${booking.uid}`)}
                      >
                        Reschedule
                      </Button>
                    ) : null}
                    <Popover
                      align="end"
                      width={210}
                      trigger={({ toggle, ref }) => (
                        <span ref={ref as (node: HTMLSpanElement | null) => void} onClick={toggle}>
                          <IconButton icon="dots" label="Booking actions" variant="minimal" size="sm" />
                        </span>
                      )}
                    >
                      {({ close }) => (
                        <DropdownMenu
                          close={close}
                          items={[
                            {
                              label: "View booking",
                              onSelect: () => navigate(`/booking/${booking.uid}`),
                            },
                            {
                              label: "Request reschedule",
                              disabled: booking.status === "cancelled",
                              onSelect: () => void act(booking, "request-reschedule"),
                            },
                            {
                              label: "Mark host absent",
                              disabled: booking.status === "cancelled",
                              onSelect: () => void act(booking, "mark-absent"),
                            },
                            {
                              label: "Cancel booking",
                              destructive: true,
                              disabled: booking.status === "cancelled",
                              onSelect: () => setCancelTarget(booking),
                            },
                          ]}
                        />
                      )}
                    </Popover>
                  </div>
                </ListRow>
              );
            })}
          </List>
        )}
      </div>

      <Dialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel this booking?"
        description="The attendee is notified that the meeting is off."
        footer={
          <>
            <Button variant="minimal" onClick={() => setCancelTarget(null)}>
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
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
        />
      </Dialog>

      <ConfirmDialog open={false} onClose={() => undefined} onConfirm={() => undefined} title="" />
    </>
  );
}
