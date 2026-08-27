// Public booking page: event meta rail, month grid, slot column — cal.com layout.
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { MonthCalendar } from "../ui/Calendar.tsx";
import { TextArea, TextField } from "../ui/Field.tsx";
import { BookingFieldInput } from "../ui/BookingFieldInput.tsx";
import { Avatar, AvatarGroup, Badge, SegmentedControl, Skeleton } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { TimezoneSelect } from "../ui/TimePickers.tsx";
import { TimeSlotColumn, capacityLabel } from "../ui/TimeSlots.tsx";
import { Icon } from "../ui/Icon.tsx";
import { locationIcon, locationLabel } from "../ui/LocationPicker.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { safeExternalUrl } from "../lib/url.ts";
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
  const [hostBio, setHostBio] = useState<string | null>(null);
  const [members, setMembers] = useState<
    Array<{ name: string; avatarUrl?: string | null; colorKey?: string }>
  >([]);
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
  const [timeFormat, setTimeFormat] = useState<12 | 24>(() =>
    localStorage.getItem("cal.bookerTimeFormat") === "24" ? 24 : 12
  );

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
          setHostBio(team.profile.bio);
          setMembers(
            team.members.map((member) => ({
              name: member.name,
              avatarUrl: member.avatarUrl,
              colorKey: member.username,
            }))
          );
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
          setHostBio(profile.profile.bio);
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

  const changeTimeFormat = (next: 12 | 24): void => {
    setTimeFormat(next);
    localStorage.setItem("cal.bookerTimeFormat", String(next));
  };

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
      // The redirect target is owner-supplied, so only follow real http(s) links.
      const redirectTo = safeExternalUrl(eventType.successRedirectUrl);
      if (redirectTo) {
        window.location.href = redirectTo;
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
          <div className="cal-booker__identity">
            {members.length > 0 ? (
              <AvatarGroup people={members} size={32} />
            ) : (
              <Avatar name={hostName} src={hostAvatar} size={38} colorKey={teamSlug ?? username} />
            )}
            <p className="cal-booker__host">{hostName}</p>
          </div>
          <h1 className="cal-booker__title">{eventType.title}</h1>
          {hostBio ? <p className="cal-booker__bio">{hostBio}</p> : null}
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
              <Icon name={locationIcon(eventType.locations[0])} size={15} />
              <span>{locationLabel(eventType.locations[0])}</span>
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
            <div className="cal-booker__panel-head">
              <div className="cal-booker__panel-title">
                <p className="cal-eyebrow">Step 2 of 2</p>
                <p className="cal-booker__panel-heading">Your details</p>
              </div>
              <Button
                variant="minimal"
                size="sm"
                startIcon="chevronLeft"
                onClick={() => setSelectedSlot(null)}
              >
                Change time
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
              {customFields.map((field) => (
                <BookingFieldInput
                  key={field.slug}
                  field={field}
                  value={responses[field.slug]}
                  onChange={(next) => setResponses({ ...responses, [field.slug]: next })}
                />
              ))}
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
              <div className="cal-booker__panel-head">
                <div className="cal-booker__panel-title">
                  <p className="cal-eyebrow">Step 1 of 2</p>
                  <p className="cal-booker__panel-heading">Pick a time</p>
                </div>
                <SegmentedControl
                  size="sm"
                  ariaLabel="Calendar layout"
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
                        <p className="cal-eyebrow">{formatDateISO(date, { weekday: "long" })}</p>
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
                              <span>{formatTime(new Date(slot.start), timeZone, timeFormat)}</span>
                              {capacityLabel(slot) ? (
                                <span className="cal-slot__seats">{capacityLabel(slot)}</span>
                              ) : null}
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
                <div className="cal-booker__panel-head">
                  <div className="cal-booker__panel-title">
                    <p className="cal-eyebrow">
                      {daySlots.length > 0
                        ? `${daySlots.length} slot${daySlots.length === 1 ? "" : "s"}`
                        : "Availability"}
                    </p>
                    <p className="cal-booker__panel-heading cal-num">
                      {selectedDate
                        ? formatDateISO(selectedDate, { weekday: "short", month: "short" })
                        : "Pick a date"}
                    </p>
                  </div>
                  <SegmentedControl
                    size="sm"
                    ariaLabel="Time format"
                    value={String(timeFormat) as "12" | "24"}
                    onChange={(next) => changeTimeFormat(next === "24" ? 24 : 12)}
                    options={[
                      { value: "12", label: "12h" },
                      { value: "24", label: "24h" },
                    ]}
                  />
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
