// Public booking page: event meta rail, month grid, slot column — cal.com layout.
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { MonthCalendar } from "../ui/Calendar.tsx";
import { Checkbox, TextArea, TextField } from "../ui/Field.tsx";
import { Avatar, AvatarGroup, Badge, SegmentedControl, Skeleton } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { TimezoneSelect } from "../ui/TimePickers.tsx";
import { TimeSlotColumn } from "../ui/TimeSlots.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking, EventType, PublicProfile, PublicTeamProfile, SlotMap } from "../lib/types.ts";
import {
  addDaysISO,
  addMonthsISO,
  browserTimeZone,
  daysInMonth,
  durationLabel,
  formatDateISO,
  formatTime,
  todayISO,
} from "../lib/time.ts";
import { useRouter } from "../app/router.tsx";
import "./BookerPage.css";

type Layout = "month" | "week" | "column";

interface BookerProps {
  username?: string;
  teamSlug?: string;
  eventSlug: string;
  rescheduleUid?: string;
}

export function BookerPage({ username, teamSlug, eventSlug, rescheduleUid }: BookerProps) {
  const { navigate } = useRouter();
  const toast = useToast();

  const [eventType, setEventType] = useState<EventType | null>(null);
  const [hostName, setHostName] = useState("");
  const [hostAvatar, setHostAvatar] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{ name: string; avatarUrl?: string | null }>>([]);
  const [notFound, setNotFound] = useState(false);

  const [timeZone, setTimeZone] = useState(browserTimeZone());
  const [layout, setLayout] = useState<Layout>("month");
  const [month, setMonth] = useState(() => `${todayISO(browserTimeZone()).slice(0, 7)}-01`);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [slots, setSlots] = useState<SlotMap>({});
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [guests, setGuests] = useState("");
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [booking, setBooking] = useState(false);
  const [reservationUid, setReservationUid] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        if (teamSlug) {
          const team = await api.get<PublicTeamProfile>(`/v2/public/teams/${teamSlug}`, undefined, {
            auth: false,
          });
          const match = team.eventTypes.find((candidate) => candidate.slug === eventSlug);
          if (!match) {
            setNotFound(true);
            return;
          }
          setEventType(match);
          setHostName(team.profile.name);
          setHostAvatar(team.profile.logoUrl);
          setMembers(team.members.map((member) => ({ name: member.name, avatarUrl: member.avatarUrl })));
        } else if (username) {
          const profile = await api.get<PublicProfile>(`/v2/public/users/${username}`, undefined, {
            auth: false,
          });
          const match = profile.eventTypes.find((candidate) => candidate.slug === eventSlug);
          if (!match) {
            setNotFound(true);
            return;
          }
          setEventType(match);
          setHostName(profile.profile.name);
          setHostAvatar(profile.profile.avatarUrl);
        }
      } catch {
        setNotFound(true);
      }
    };
    void load();
  }, [username, teamSlug, eventSlug]);

  useEffect(() => {
    if (!eventType) return;
    setDuration(eventType.lengthInMinutes);
    const layouts = eventType.bookerLayouts?.enabledLayouts;
    if (layouts?.length) setLayout((eventType.bookerLayouts?.defaultLayout as Layout) ?? "month");
    if (eventType.lockTimeZoneToggleOnBookingPage) setTimeZone(browserTimeZone());
  }, [eventType]);

  const rangeStart = useMemo(() => {
    const today = todayISO(timeZone);
    const monthStart = `${month.slice(0, 7)}-01`;
    return monthStart < today ? today : monthStart;
  }, [month, timeZone]);

  const rangeEnd = useMemo(
    () => addDaysISO(`${month.slice(0, 7)}-01`, daysInMonth(month)),
    [month]
  );

  useEffect(() => {
    if (!eventType) return;
    setLoadingSlots(true);
    void api
      .get<SlotMap>(
        "/v2/slots",
        {
          eventTypeId: eventType.id,
          start: `${rangeStart}T00:00:00.000Z`,
          end: `${rangeEnd}T00:00:00.000Z`,
          timeZone,
          duration: duration ?? undefined,
          bookingUidToReschedule: rescheduleUid,
        },
        { auth: false }
      )
      .then((data) => {
        setSlots(data);
        const dates = Object.keys(data).sort();
        if (!selectedDate && dates.length > 0) setSelectedDate(dates[0]);
      })
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => setLoadingSlots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, rangeStart, rangeEnd, timeZone, duration, rescheduleUid]);

  const enabledDates = useMemo(() => new Set(Object.keys(slots)), [slots]);
  const daySlots = selectedDate ? slots[selectedDate] ?? [] : [];
  const timeFormat: 12 | 24 = 12;

  const reserve = async (start: string): Promise<void> => {
    setSelectedSlot(start);
    if (!eventType) return;
    try {
      const reservation = await api.post<{ reservationUid: string }>(
        "/v2/slots/reservations",
        { eventTypeId: eventType.id, slotStart: start, slotDuration: duration ?? undefined },
        { auth: false }
      );
      setReservationUid(reservation.reservationUid);
    } catch {
      // Holding a slot is best effort — booking still validates availability.
      setReservationUid(null);
    }
  };

  const submit = async (): Promise<void> => {
    if (!eventType || !selectedSlot) return;
    setBooking(true);
    try {
      const guestEmails = guests
        .split(",")
        .map((guest) => guest.trim())
        .filter((guest) => guest.includes("@"));

      if (rescheduleUid) {
        const rescheduled = await api.post<Booking>(
          `/v2/bookings/${rescheduleUid}/reschedule`,
          { start: selectedSlot, reschedulingReason: notes || undefined, email },
          { auth: false }
        );
        navigate(`/booking/${rescheduled.uid}`);
        return;
      }

      const created = await api.post<Booking>(
        "/v2/bookings",
        {
          start: selectedSlot,
          eventTypeId: eventType.id,
          attendee: { name, email, timeZone, language: "en" },
          guests: guestEmails,
          lengthInMinutes: duration ?? undefined,
          bookingFieldsResponses: { ...responses, notes },
          reservationUid: reservationUid ?? undefined,
        },
        { auth: false }
      );
      if (eventType.successRedirectUrl) {
        window.location.href = eventType.successRedirectUrl;
        return;
      }
      navigate(`/booking/${created.uid}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBooking(false);
    }
  };

  if (notFound) {
    return (
      <div className="cal-booker__missing">
        <h1>This event does not exist</h1>
        <p className="cal-muted">The link may have been changed or the event hidden.</p>
      </div>
    );
  }

  if (!eventType) {
    return (
      <div className="cal-booker">
        <div className="cal-booker__frame cal-card">
          <Skeleton height={360} />
        </div>
      </div>
    );
  }

  const locationLabel = (): string => {
    const location = eventType.locations[0];
    if (!location) return "Location to be confirmed";
    if (location.type === "integration") return location.integration === "cal-video" ? "Cal Video" : String(location.integration);
    if (location.type === "link") return "Web conferencing";
    if (location.type === "address") return String(location.address);
    if (location.type === "phone") return String(location.phone);
    if (location.type === "attendeePhone") return "Attendee phone";
    if (location.type === "attendeeAddress") return "Attendee address";
    return "Custom location";
  };

  const customFields = eventType.bookingFields.filter(
    (field) =>
      !["name", "email", "location", "notes", "guests", "rescheduleReason", "title", "splitName"].includes(
        field.type
      ) && !field.hidden
  );

  const showForm = selectedSlot !== null;

  return (
    <div className="cal-booker">
      <div className={`cal-booker__frame cal-card ${showForm ? "is-form" : ""}`}>
        <aside className="cal-booker__meta">
          {members.length > 0 ? (
            <AvatarGroup people={members} size={32} />
          ) : (
            <Avatar name={hostName} src={hostAvatar} size={38} />
          )}
          <p className="cal-booker__host">{hostName}</p>
          <h1 className="cal-booker__title">{eventType.title}</h1>
          {eventType.description ? <p className="cal-booker__desc">{eventType.description}</p> : null}

          <ul className="cal-booker__facts">
            {selectedSlot ? (
              <li>
                <Icon name="calendar" size={15} />
                <span>
                  {formatDateISO(selectedDate ?? "", { weekday: "long" })},{" "}
                  {formatTime(new Date(selectedSlot), timeZone, timeFormat)}
                </span>
              </li>
            ) : null}
            <li>
              <Icon name="clock" size={15} />
              {eventType.lengthInMinutesOptions?.length ? (
                <div style={{ width: 140 }}>
                  <Select
                    size="sm"
                    value={duration}
                    options={[eventType.lengthInMinutes, ...eventType.lengthInMinutesOptions]
                      .filter((minutes, index, list) => list.indexOf(minutes) === index)
                      .map((minutes) => ({ value: minutes, label: durationLabel(minutes) }))}
                    onChange={(next) => {
                      setDuration(next);
                      setSelectedSlot(null);
                    }}
                  />
                </div>
              ) : (
                <span>{durationLabel(eventType.lengthInMinutes)}</span>
              )}
            </li>
            <li>
              <Icon name={eventType.locations[0]?.type === "phone" ? "phone" : "video"} size={15} />
              <span>{locationLabel()}</span>
            </li>
            {eventType.recurrence && !eventType.recurrence.disabled ? (
              <li>
                <Icon name="refresh" size={15} />
                <span>
                  Repeats {eventType.recurrence.frequency} · up to {eventType.recurrence.occurrences} times
                </span>
              </li>
            ) : null}
            {eventType.seats && !eventType.seats.disabled ? (
              <li>
                <Icon name="users" size={15} />
                <span>{eventType.seats.seatsPerTimeSlot} seats per slot</span>
              </li>
            ) : null}
            <li>
              <Icon name="globe" size={15} />
              {eventType.lockTimeZoneToggleOnBookingPage ? (
                <span>{timeZone}</span>
              ) : (
                <div style={{ width: 200 }}>
                  <TimezoneSelect size="sm" value={timeZone} onChange={setTimeZone} />
                </div>
              )}
            </li>
          </ul>

          {rescheduleUid ? <Badge tone="attention">Rescheduling an existing booking</Badge> : null}
        </aside>

        {showForm ? (
          <section className="cal-booker__form">
            <div className="cal-booker__form-head">
              <Button variant="minimal" size="sm" startIcon="chevronLeft" onClick={() => setSelectedSlot(null)}>
                Back
              </Button>
            </div>
            <div className="cal-stack">
              <TextField
                label="Your name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <TextField
                label="Email address"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {customFields.map((field) => {
                const label = field.label ?? field.slug;
                if (field.type === "boolean") {
                  return (
                    <Checkbox
                      key={field.slug}
                      label={label}
                      checked={Boolean(responses[field.slug])}
                      onChange={(event) =>
                        setResponses({ ...responses, [field.slug]: event.target.checked })
                      }
                    />
                  );
                }
                if (["select", "radio"].includes(field.type)) {
                  return (
                    <Select
                      key={field.slug}
                      label={label}
                      value={(responses[field.slug] as string) ?? null}
                      options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
                      onChange={(next) => setResponses({ ...responses, [field.slug]: next })}
                    />
                  );
                }
                if (field.type === "textarea") {
                  return (
                    <TextArea
                      key={field.slug}
                      label={label}
                      required={field.required}
                      value={(responses[field.slug] as string) ?? ""}
                      onChange={(event) =>
                        setResponses({ ...responses, [field.slug]: event.target.value })
                      }
                    />
                  );
                }
                return (
                  <TextField
                    key={field.slug}
                    label={label}
                    required={field.required}
                    type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
                    value={(responses[field.slug] as string) ?? ""}
                    onChange={(event) => setResponses({ ...responses, [field.slug]: event.target.value })}
                  />
                );
              })}
              <TextArea
                label="Additional notes"
                placeholder="Please share anything that will help prepare for our meeting."
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
              {eventType.disableGuests ? null : (
                <TextField
                  label="Add guests"
                  hint="Comma separated email addresses"
                  value={guests}
                  onChange={(event) => setGuests(event.target.value)}
                />
              )}
              <div className="cal-row">
                <div className="cal-spacer" />
                <Button
                  size="lg"
                  loading={booking}
                  disabled={!name.trim() || !email.includes("@")}
                  onClick={() => void submit()}
                >
                  {rescheduleUid ? "Reschedule" : "Confirm"}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="cal-booker__calendar">
              <div className="cal-booker__layout">
                <SegmentedControl
                  value={layout}
                  onChange={(next) => setLayout(next)}
                  options={[
                    { value: "month", label: "Month", icon: "calendar" },
                    { value: "column", label: "List", icon: "grid" },
                  ]}
                />
              </div>
              {layout === "month" ? (
                <MonthCalendar
                  month={month}
                  onMonthChange={(next) => {
                    setMonth(next);
                    setSelectedDate(null);
                  }}
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  enabledDates={enabledDates}
                  timeZone={timeZone}
                  loading={loadingSlots}
                />
              ) : (
                <div className="cal-booker__list">
                  {Object.keys(slots)
                    .sort()
                    .map((date) => (
                      <div key={date} className="cal-booker__list-day">
                        <p className="cal-section-title">{formatDateISO(date, { weekday: "long" })}</p>
                        <div className="cal-booker__list-slots">
                          {(slots[date] ?? []).map((slot) => (
                            <button
                              key={slot.start}
                              type="button"
                              className="cal-slot"
                              onClick={() => {
                                setSelectedDate(date);
                                void reserve(slot.start);
                              }}
                            >
                              {formatTime(new Date(slot.start), timeZone, timeFormat)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  {Object.keys(slots).length === 0 && !loadingSlots ? (
                    <p className="cal-hint">No availability this month.</p>
                  ) : null}
                </div>
              )}
              {layout === "month" ? (
                <button
                  type="button"
                  className="cal-booker__next-month"
                  onClick={() => setMonth(addMonthsISO(month, 1))}
                >
                  Next month <Icon name="chevronRight" size={12} />
                </button>
              ) : null}
            </section>

            {layout === "month" ? (
              <section className="cal-booker__slots">
                <div className="cal-booker__slots-head">
                  <strong>{selectedDate ? formatDateISO(selectedDate, { weekday: "short" }) : "Pick a date"}</strong>
                </div>
                <TimeSlotColumn
                  slots={daySlots}
                  timeZone={timeZone}
                  timeFormat={timeFormat}
                  selected={selectedSlot}
                  loading={loadingSlots}
                  onSelect={(start) => void reserve(start)}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
      <p className="cal-booker__footer">Powered by Cal</p>
    </div>
  );
}
