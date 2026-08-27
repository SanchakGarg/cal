import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TextArea } from "../ui/Field.tsx";
import { Avatar, Badge, EmptyState, List, ListRow, PageHeader, SkeletonList, Tabs } from "../ui/Layout.tsx";
import { DropdownMenu, Popover } from "../ui/Popover.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking } from "../lib/types.ts";
import { formatDateTime, formatTime } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./BookingsPage.css";

export type BookingStatus = "upcoming" | "unconfirmed" | "recurring" | "past" | "cancelled";

const ACTION_LABELS: Record<string, string> = {
  confirm: "Booking confirmed",
  decline: "Booking rejected",
  "mark-absent": "Host marked absent",
  "request-reschedule": "Reschedule requested",
};

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
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");

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

  const requestReschedule = async (): Promise<void> => {
    if (!rescheduleTarget) return;
    setBusyUid(rescheduleTarget.uid);
    try {
      await api.post(`/v2/bookings/${rescheduleTarget.uid}/request-reschedule`, {
        reason: reason.trim() || undefined,
      });
      toast.success("Asked them to pick a new time");
      setRescheduleTarget(null);
      setReason("");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyUid(null);
    }
  };

  const act = async (
    booking: Booking,
    action: "confirm" | "decline" | "mark-absent" | "request-reschedule"
  ): Promise<void> => {
    setBusyUid(booking.uid);
    try {
      await api.post(
        `/v2/bookings/${booking.uid}/${action}`,
        action === "mark-absent" ? { host: true } : {}
      );
      toast.success(ACTION_LABELS[action]);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyUid(null);
    }
  };

  const timeZone = me?.timeZone ?? "UTC";

  return (
    <>
      <PageHeader title="Bookings" subtitle="See upcoming and past events booked through your links." />
      <Tabs tabs={TABS} value={status} onChange={(next) => navigate(`/bookings/${next}`)} />

      <div className="cal-bookings">
        {bookings === null ? (
          <SkeletonList rows={3} height={52} />
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
                      {booking.absentHost ? <Badge tone="error">Host absent</Badge> : null}
                    </div>
                    {attendee ? (
                      <div className="cal-row cal-booking__attendee">
                        <Avatar name={attendee.name} size={20} colorKey={attendee.email} />
                        <span className="cal-hint">
                          {attendee.name} · {attendee.email}
                        </span>
                        {attendee.absent ? <Badge tone="error">No-show</Badge> : null}
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
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busyUid === booking.uid}
                          onClick={() => void act(booking, "decline")}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          loading={busyUid === booking.uid}
                          onClick={() => void act(booking, "confirm")}
                        >
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
                              onSelect: () => setRescheduleTarget(booking),
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
                              onSelect: () => navigate(`/bookings/${booking.uid}/cancel`),
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
        open={rescheduleTarget !== null}
        onClose={() => {
          setRescheduleTarget(null);
          setReason("");
        }}
        title="Ask for a new time?"
        description="The current time is released and they are emailed a link to pick another."
        footer={
          <>
            <Button
              variant="minimal"
              onClick={() => {
                setRescheduleTarget(null);
                setReason("");
              }}
            >
              Keep the time
            </Button>
            <Button
              loading={busyUid === rescheduleTarget?.uid}
              onClick={() => void requestReschedule()}
            >
              Send request
            </Button>
          </>
        }
      >
        <TextArea
          label="Why the change?"
          hint="Included in the email, so they know what happened."
          placeholder="Something came up on my side — sorry about the short notice."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Dialog>
    </>
  );
}
