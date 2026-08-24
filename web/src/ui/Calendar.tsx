import { Icon } from "./Icon.tsx";
import {
  addDaysISO,
  addMonthsISO,
  daysInMonth,
  monthLabel,
  todayISO,
  weekdayOfDateISO,
} from "../lib/time.ts";
import "./Calendar.css";

interface MonthCalendarProps {
  /** First day of the displayed month, `YYYY-MM-01`. */
  month: string;
  onMonthChange: (month: string) => void;
  selected?: string | null;
  onSelect?: (date: string) => void;
  /** Dates that have at least one slot. Omit to enable every future date. */
  enabledDates?: Set<string> | null;
  weekStart?: "Sunday" | "Monday";
  timeZone?: string;
  loading?: boolean;
  minDate?: string;
}

export function MonthCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  enabledDates = null,
  weekStart = "Monday",
  timeZone = "UTC",
  loading = false,
  minDate,
}: MonthCalendarProps) {
  const first = `${month.slice(0, 7)}-01`;
  const total = daysInMonth(first);
  const offset = (weekdayOfDateISO(first) - (weekStart === "Monday" ? 1 : 0) + 7) % 7;
  const today = todayISO(timeZone);
  const floor = minDate ?? today;

  const headers = weekStart === "Monday"
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const cells: Array<string | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_unused, index) => addDaysISO(first, index)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="cal-calendar">
      <div className="cal-calendar__head">
        <h2>{monthLabel(first)}</h2>
        <div className="cal-calendar__nav">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(addMonthsISO(first, -1))}
            disabled={first <= `${floor.slice(0, 7)}-01`}
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button type="button" aria-label="Next month" onClick={() => onMonthChange(addMonthsISO(first, 1))}>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </div>
      <div className="cal-calendar__weekdays">
        {headers.map((header) => (
          <span key={header}>{header}</span>
        ))}
      </div>
      <div className={`cal-calendar__grid ${loading ? "is-loading" : ""}`}>
        {cells.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} className="cal-calendar__empty" />;
          const isPast = date < floor;
          const hasSlots = enabledDates ? enabledDates.has(date) : !isPast;
          const disabled = isPast || !hasSlots || !onSelect;
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-label={date}
              aria-pressed={selected === date}
              className={`cal-calendar__day ${selected === date ? "is-selected" : ""} ${
                hasSlots && !isPast ? "has-slots" : ""
              } ${date === today ? "is-today" : ""}`}
              onClick={() => onSelect?.(date)}
            >
              {Number(date.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
