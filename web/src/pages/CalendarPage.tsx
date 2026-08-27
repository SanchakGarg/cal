// Master calendar: every booking the signed-in user can see, in day, week or
// month form. The bookings list already answers range queries, so this is a
// different presentation of the same data rather than a new endpoint.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { Badge, EmptyState, PageHeader, SegmentedControl, Skeleton } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { Switch } from "../ui/Switch.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking, Team } from "../lib/types.ts";
import {
  addDaysISO,
  dateISOInZone,
  formatDateISO,
  formatTime,
  todayISO,
  weekdayOfDateISO,
  zonedParts,
  zonedTimeToUtc,
} from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./CalendarPage.css";

export type CalendarView = "day" | "week" | "month";

const VIEWS: Array<{ value: CalendarView; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const DAY_MINUTES = 24 * 60;
/** Pixels per hour in the day and week grids. */
const HOUR_HEIGHT = 48;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Stable per-event-type colour so the same meeting reads the same all week. */
function hueFor(booking: Booking): number {
  const seed = booking.eventTypeId ?? hashString(booking.title);
  return (seed * 47) % 360;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100000;
  }
  return hash;
}

function minutesIntoDay(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

/** First day of the week containing `dateISO`, honouring the user's weekStart. */
function startOfWeekISO(dateISO: string, weekStart: string): string {
  const target = WEEKDAY_LABELS.findIndex((label) => weekStart.startsWith(label));
  const first = target === -1 ? 1 : target;
  const current = weekdayOfDateISO(dateISO);
  const back = (current - first + 7) % 7;
  return addDaysISO(dateISO, -back);
}

function startOfMonthISO(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

function addMonths(dateISO: string, months: number): string {
  const [year, month] = dateISO.split("-").map(Number);
  const total = (year * 12 + (month - 1)) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

interface DayRange {
  /** Inclusive first day shown. */
  startISO: string;
  /** Exclusive day after the last one shown. */
  endISO: string;
  days: string[];
}

function rangeFor(view: CalendarView, anchorISO: string, weekStart: string): DayRange {
  if (view === "day") {
    return { startISO: anchorISO, endISO: addDaysISO(anchorISO, 1), days: [anchorISO] };
  }
  if (view === "week") {
    const start = startOfWeekISO(anchorISO, weekStart);
    const days = Array.from({ length: 7 }, (_, index) => addDaysISO(start, index));
    return { startISO: start, endISO: addDaysISO(start, 7), days };
  }
  // The month grid always shows whole weeks, so it spills into the neighbours.
  const first = startOfMonthISO(anchorISO);
  const start = startOfWeekISO(first, weekStart);
  const nextMonth = addMonths(first, 1);
  let count = 0;
  while (addDaysISO(start, count) < nextMonth) count += 1;
  const weeks = Math.ceil(count / 7);
  const days = Array.from({ length: weeks * 7 }, (_, index) => addDaysISO(start, index));
  return { startISO: start, endISO: addDaysISO(start, weeks * 7), days };
}

export function CalendarPage({ view }: { view: CalendarView }) {
  const { me } = useAuth();
  const timeFormat = useTimeFormat();
  const { navigate, search } = useRouter();
  const toast = useToast();

  const timeZone = me?.timeZone ?? "UTC";
  const weekStart = me?.weekStart ?? "Monday";

  const dateParam = search.get("date");
  const anchorISO = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? dateParam! : todayISO(timeZone);
  const teamParam = search.get("team") ?? "mine";

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);

  const range = useMemo(() => rangeFor(view, anchorISO, weekStart), [view, anchorISO, weekStart]);

  useEffect(() => {
    void api
      .get<Team[]>("/v2/teams")
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBookings(null);
    // The API filters on whole bookings falling inside the window, so widen it
    // by a day at each end and trim to the visible range below.
    const from = zonedTimeToUtc(addDaysISO(range.startISO, -1), "00:00", timeZone);
    const to = zonedTimeToUtc(addDaysISO(range.endISO, 1), "00:00", timeZone);
    void api
      .get<Booking[]>("/v2/bookings", {
        afterStart: from.toISOString(),
        beforeEnd: to.toISOString(),
        teamId: teamParam === "mine" ? undefined : teamParam,
        limit: 250,
        sortStart: "asc",
      })
      .then((rows) => {
        if (!cancelled) setBookings(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(errorMessage(error));
        setBookings([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.startISO, range.endISO, teamParam, timeZone]);

  const visible = useMemo(() => {
    if (!bookings) return null;
    const from = zonedTimeToUtc(range.startISO, "00:00", timeZone).getTime();
    const to = zonedTimeToUtc(range.endISO, "00:00", timeZone).getTime();
    return bookings
      .filter((booking) => showCancelled || (booking.status !== "cancelled" && booking.status !== "rejected"))
      .filter((booking) => {
        const start = Date.parse(booking.start);
        const end = Date.parse(booking.end);
        return end > from && start < to;
      })
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }, [bookings, range.startISO, range.endISO, timeZone, showCancelled]);

  const go = (nextView: CalendarView, nextDateISO: string): void => {
    const params = new URLSearchParams();
    params.set("date", nextDateISO);
    if (teamParam !== "mine") params.set("team", teamParam);
    navigate(`/calendar/${nextView}?${params.toString()}`);
  };

  const step = (direction: 1 | -1): void => {
    if (view === "day") go(view, addDaysISO(anchorISO, direction));
    else if (view === "week") go(view, addDaysISO(anchorISO, 7 * direction));
    else go(view, addMonths(startOfMonthISO(anchorISO), direction));
  };

  const heading =
    view === "month"
      ? formatDateISO(startOfMonthISO(anchorISO), {
          weekday: undefined,
          month: "long",
          day: undefined,
          year: "numeric",
        })
      : view === "day"
        ? formatDateISO(anchorISO, { weekday: "long", month: "long", day: "numeric" })
        : `${formatDateISO(range.days[0], { weekday: undefined, month: "short", day: "numeric", year: undefined })} – ${formatDateISO(
            range.days[6],
            { weekday: undefined, month: "short", day: "numeric", year: "numeric" }
          )}`;

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Every booking on your calendar, across your own links and your teams."
        actions={
          <Select
            value={teamParam}
            width={200}
            options={[
              { value: "mine", label: "My bookings" },
              ...teams.map((team) => ({ value: String(team.id), label: team.name })),
            ]}
            onChange={(next) => {
              const params = new URLSearchParams({ date: anchorISO });
              if (next !== "mine") params.set("team", next);
              navigate(`/calendar/${view}?${params.toString()}`);
            }}
          />
        }
      />

      <div className="cal-calendar__toolbar">
        <div className="cal-calendar__nav">
          <IconButton icon="chevronLeft" label="Previous" variant="secondary" size="sm" onClick={() => step(-1)} />
          <Button variant="secondary" size="sm" onClick={() => go(view, todayISO(timeZone))}>
            Today
          </Button>
          <IconButton icon="chevronRight" label="Next" variant="secondary" size="sm" onClick={() => step(1)} />
          <h2 className="cal-calendar__heading">{heading}</h2>
        </div>
        <div className="cal-calendar__controls">
          <Switch
            size="sm"
            checked={showCancelled}
            onChange={setShowCancelled}
            label="Show cancelled"
          />
          <SegmentedControl
            options={VIEWS}
            value={view}
            onChange={(next) => go(next, anchorISO)}
          />
        </div>
      </div>

      {visible === null ? (
        <Skeleton height={520} />
      ) : view === "month" ? (
        <MonthGrid
          days={range.days}
          anchorISO={anchorISO}
          bookings={visible}
          timeZone={timeZone}
          timeFormat={timeFormat}
          onOpen={(uid) => navigate(`/booking/${uid}`)}
          onPickDay={(dateISO) => go("day", dateISO)}
        />
      ) : (
        <TimeGrid
          days={range.days}
          bookings={visible}
          timeZone={timeZone}
          timeFormat={timeFormat}
          onOpen={(uid) => navigate(`/booking/${uid}`)}
        />
      )}

      {visible !== null && visible.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing scheduled"
          description="Bookings in this period will appear here."
        />
      ) : null}
    </>
  );
}

interface GridProps {
  days: string[];
  bookings: Booking[];
  timeZone: string;
  timeFormat: 12 | 24;
  onOpen: (uid: string) => void;
}

/** Day and week share the same hour grid; a day is just one column. */
function TimeGrid({ days, bookings, timeZone, timeFormat, onOpen }: GridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const todayLocal = todayISO(timeZone);

  const perDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const dateISO of days) map.set(dateISO, []);
    for (const booking of bookings) {
      // A booking that runs past midnight shows on each day it touches.
      for (const dateISO of days) {
        const dayStart = zonedTimeToUtc(dateISO, "00:00", timeZone).getTime();
        const dayEnd = dayStart + DAY_MINUTES * 60000;
        if (Date.parse(booking.end) > dayStart && Date.parse(booking.start) < dayEnd) {
          map.get(dateISO)!.push(booking);
        }
      }
    }
    return map;
  }, [days, bookings, timeZone]);

  // Open on the working day rather than at midnight.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const earliest = bookings.reduce<number | null>((min, booking) => {
      const minutes = minutesIntoDay(new Date(booking.start), timeZone);
      return min === null || minutes < min ? minutes : min;
    }, null);
    const target = Math.max(0, ((earliest ?? 8 * 60) - 30) / 60) * HOUR_HEIGHT;
    node.scrollTop = target;
  }, [bookings, timeZone, days.length]);

  return (
    <div className="cal-calendar cal-card">
      <div className="cal-calendar__head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <span />
        {days.map((dateISO) => (
          <div
            key={dateISO}
            className={`cal-calendar__daylabel ${dateISO === todayLocal ? "is-today" : ""}`}
          >
            <span className="cal-calendar__dayname">{WEEKDAY_LABELS[weekdayOfDateISO(dateISO)]}</span>
            <span className="cal-calendar__daynum">{Number(dateISO.slice(8, 10))}</span>
          </div>
        ))}
      </div>

      <div className="cal-calendar__scroll" ref={scrollRef}>
        <div
          className="cal-calendar__body"
          style={{
            gridTemplateColumns: `56px repeat(${days.length}, 1fr)`,
            height: 24 * HOUR_HEIGHT,
          }}
        >
          <div className="cal-calendar__gutter">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="cal-calendar__hourlabel" style={{ height: HOUR_HEIGHT }}>
                {hour === 0 ? "" : formatHour(hour, timeFormat)}
              </div>
            ))}
          </div>

          {days.map((dateISO) => {
            const dayStart = zonedTimeToUtc(dateISO, "00:00", timeZone).getTime();
            const items = perDay.get(dateISO) ?? [];
            const laidOut = layout(items, dayStart);
            return (
              <div key={dateISO} className="cal-calendar__column">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="cal-calendar__hourline" style={{ height: HOUR_HEIGHT }} />
                ))}
                {dateISO === todayLocal ? <NowLine timeZone={timeZone} /> : null}
                {laidOut.map(({ booking, top, height, column, columns }) => (
                  <button
                    key={`${booking.uid}-${dateISO}`}
                    type="button"
                    className={`cal-event ${booking.status === "cancelled" || booking.status === "rejected" ? "is-cancelled" : ""}`}
                    style={{
                      top: `${top}px`,
                      height: `${Math.max(height, 18)}px`,
                      left: `calc(${(column / columns) * 100}% + 2px)`,
                      width: `calc(${(1 / columns) * 100}% - 6px)`,
                      "--cal-event-hue": hueFor(booking),
                    } as React.CSSProperties}
                    onClick={() => onOpen(booking.uid)}
                  >
                    <span className="cal-event__time">
                      {formatTime(new Date(booking.start), timeZone, timeFormat)}
                    </span>
                    <span className="cal-event__title">{booking.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface Positioned {
  booking: Booking;
  top: number;
  height: number;
  column: number;
  columns: number;
}

/** Side-by-side placement for bookings that overlap in the same day column. */
function layout(bookings: Booking[], dayStartMs: number): Positioned[] {
  const spans = bookings
    .map((booking) => {
      const startMs = Math.max(Date.parse(booking.start), dayStartMs);
      const endMs = Math.min(Date.parse(booking.end), dayStartMs + DAY_MINUTES * 60000);
      const startMinutes = (startMs - dayStartMs) / 60000;
      const endMinutes = Math.max((endMs - dayStartMs) / 60000, startMinutes + 15);
      return { booking, startMinutes, endMinutes };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  const positioned: Positioned[] = [];
  let cluster: typeof spans = [];
  let clusterEnd = -1;

  const flush = (): void => {
    if (cluster.length === 0) return;
    // Greedy column assignment inside the overlapping cluster.
    const columnEnds: number[] = [];
    const assigned = cluster.map((span) => {
      let column = columnEnds.findIndex((end) => end <= span.startMinutes);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(span.endMinutes);
      } else {
        columnEnds[column] = span.endMinutes;
      }
      return { span, column };
    });
    for (const { span, column } of assigned) {
      positioned.push({
        booking: span.booking,
        top: (span.startMinutes / 60) * HOUR_HEIGHT,
        height: ((span.endMinutes - span.startMinutes) / 60) * HOUR_HEIGHT,
        column,
        columns: columnEnds.length,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const span of spans) {
    if (cluster.length > 0 && span.startMinutes >= clusterEnd) flush();
    cluster.push(span);
    clusterEnd = Math.max(clusterEnd, span.endMinutes);
  }
  flush();
  return positioned;
}

/** The "you are here" line, refreshed once a minute. */
function NowLine({ timeZone }: { timeZone: string }) {
  const [minutes, setMinutes] = useState(() => minutesIntoDay(new Date(), timeZone));
  useEffect(() => {
    const timer = window.setInterval(() => setMinutes(minutesIntoDay(new Date(), timeZone)), 60_000);
    return () => window.clearInterval(timer);
  }, [timeZone]);
  return <div className="cal-calendar__now" style={{ top: (minutes / 60) * HOUR_HEIGHT }} />;
}

function formatHour(hour: number, timeFormat: 12 | 24): string {
  if (timeFormat === 24) return `${String(hour).padStart(2, "0")}:00`;
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

function MonthGrid({
  days,
  anchorISO,
  bookings,
  timeZone,
  timeFormat,
  onOpen,
  onPickDay,
}: GridProps & { anchorISO: string; onPickDay: (dateISO: string) => void }) {
  const month = anchorISO.slice(0, 7);
  const todayLocal = todayISO(timeZone);

  const perDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const dateISO of days) map.set(dateISO, []);
    for (const booking of bookings) {
      const dateISO = dateISOInZone(new Date(booking.start), timeZone);
      map.get(dateISO)?.push(booking);
    }
    return map;
  }, [days, bookings, timeZone]);

  return (
    <div className="cal-calendar cal-card">
      <div className="cal-calendar__head cal-calendar__head--month">
        {days.slice(0, 7).map((dateISO) => (
          <div key={dateISO} className="cal-calendar__daylabel">
            <span className="cal-calendar__dayname">{WEEKDAY_LABELS[weekdayOfDateISO(dateISO)]}</span>
          </div>
        ))}
      </div>
      <div className="cal-calendar__month">
        {days.map((dateISO) => {
          const items = perDay.get(dateISO) ?? [];
          return (
            <div
              key={dateISO}
              className={`cal-calendar__cell ${dateISO.slice(0, 7) === month ? "" : "is-outside"} ${
                dateISO === todayLocal ? "is-today" : ""
              }`}
            >
              <button
                type="button"
                className="cal-calendar__celldate"
                onClick={() => onPickDay(dateISO)}
              >
                {Number(dateISO.slice(8, 10))}
              </button>
              <div className="cal-calendar__cellitems">
                {items.slice(0, 3).map((booking) => (
                  <button
                    key={booking.uid}
                    type="button"
                    className={`cal-chip ${booking.status === "cancelled" || booking.status === "rejected" ? "is-cancelled" : ""}`}
                    style={{ "--cal-event-hue": hueFor(booking) } as React.CSSProperties}
                    onClick={() => onOpen(booking.uid)}
                    title={booking.title}
                  >
                    <span className="cal-chip__dot" />
                    <span className="cal-chip__time">
                      {formatTime(new Date(booking.start), timeZone, timeFormat)}
                    </span>
                    <span className="cal-chip__title">{booking.title}</span>
                  </button>
                ))}
                {items.length > 3 ? (
                  <button
                    type="button"
                    className="cal-calendar__more"
                    onClick={() => onPickDay(dateISO)}
                  >
                    +{items.length - 3} more
                  </button>
                ) : null}
              </div>
              {items.some((booking) => booking.status === "pending") ? (
                <Badge tone="attention">Unconfirmed</Badge>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
