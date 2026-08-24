// Day-by-day weekly editor plus date override list, matching cal.com's layout.
import { useState } from "react";
import { Button, IconButton } from "./Button.tsx";
import { Checkbox } from "./Field.tsx";
import { Icon } from "./Icon.tsx";
import { Badge } from "./Layout.tsx";
import { Popover } from "./Popover.tsx";
import { Switch } from "./Switch.tsx";
import { TimeSelect } from "./TimePickers.tsx";
import { MonthCalendar } from "./Calendar.tsx";
import { Dialog } from "./Dialog.tsx";
import {
  WEEK_DAYS,
  type WeekDayName,
  addMonthsISO,
  formatDateISO,
  formatHHMM,
  minutesOf,
  todayISO,
} from "../lib/time.ts";
import "./AvailabilityEditor.css";

export interface TimeRange {
  startTime: string;
  endTime: string;
}

/** Weekly grid state: one entry per weekday, empty array = day off. */
export type WeeklySchedule = Record<WeekDayName, TimeRange[]>;

export const EMPTY_WEEK: WeeklySchedule = {
  Sunday: [],
  Monday: [],
  Tuesday: [],
  Wednesday: [],
  Thursday: [],
  Friday: [],
  Saturday: [],
};

export function defaultWeek(): WeeklySchedule {
  return {
    ...EMPTY_WEEK,
    Monday: [{ startTime: "09:00", endTime: "17:00" }],
    Tuesday: [{ startTime: "09:00", endTime: "17:00" }],
    Wednesday: [{ startTime: "09:00", endTime: "17:00" }],
    Thursday: [{ startTime: "09:00", endTime: "17:00" }],
    Friday: [{ startTime: "09:00", endTime: "17:00" }],
  };
}

/** API `availability[]` blocks to the weekly grid. */
export function blocksToWeek(
  blocks: Array<{ days: string[]; startTime: string; endTime: string }>
): WeeklySchedule {
  const week: WeeklySchedule = { ...EMPTY_WEEK };
  for (const day of WEEK_DAYS) week[day] = [];
  for (const block of blocks) {
    for (const day of block.days) {
      if (!WEEK_DAYS.includes(day as WeekDayName)) continue;
      week[day as WeekDayName] = [
        ...week[day as WeekDayName],
        { startTime: block.startTime, endTime: block.endTime },
      ].sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
    }
  }
  return week;
}

/** Weekly grid back to API blocks, grouping days that share the same ranges. */
export function weekToBlocks(week: WeeklySchedule): Array<{ days: string[]; startTime: string; endTime: string }> {
  const grouped = new Map<string, { days: string[]; startTime: string; endTime: string }>();
  for (const day of WEEK_DAYS) {
    for (const range of week[day]) {
      const key = `${range.startTime}-${range.endTime}`;
      const entry = grouped.get(key) ?? { days: [], startTime: range.startTime, endTime: range.endTime };
      entry.days.push(day);
      grouped.set(key, entry);
    }
  }
  return [...grouped.values()];
}

interface WeeklyEditorProps {
  week: WeeklySchedule;
  onChange: (week: WeeklySchedule) => void;
  timeFormat: 12 | 24;
}

export function WeeklyEditor({ week, onChange, timeFormat }: WeeklyEditorProps) {
  const setDay = (day: WeekDayName, ranges: TimeRange[]): void => {
    onChange({ ...week, [day]: ranges });
  };

  return (
    <div className="cal-week">
      {WEEK_DAYS.map((day) => (
        <DayRow
          key={day}
          day={day}
          ranges={week[day]}
          timeFormat={timeFormat}
          onChange={(ranges) => setDay(day, ranges)}
          onCopyTo={(targets) => {
            const next = { ...week };
            for (const target of targets) next[target] = week[day].map((range) => ({ ...range }));
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

interface DayRowProps {
  day: WeekDayName;
  ranges: TimeRange[];
  timeFormat: 12 | 24;
  onChange: (ranges: TimeRange[]) => void;
  onCopyTo: (days: WeekDayName[]) => void;
}

function DayRow({ day, ranges, timeFormat, onChange, onCopyTo }: DayRowProps) {
  const enabled = ranges.length > 0;

  const toggle = (value: boolean): void => {
    onChange(value ? [{ startTime: "09:00", endTime: "17:00" }] : []);
  };

  const addRange = (): void => {
    const last = ranges[ranges.length - 1];
    const startMinutes = last ? Math.min(minutesOf(last.endTime) + 60, 22 * 60) : 9 * 60;
    const pad = (value: number): string => String(value).padStart(2, "0");
    const toTime = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    onChange([...ranges, { startTime: toTime(startMinutes), endTime: toTime(startMinutes + 60) }]);
  };

  return (
    <div className={`cal-day-row ${enabled ? "" : "is-off"}`}>
      <div className="cal-day-row__toggle">
        <Switch checked={enabled} onChange={toggle} size="sm" />
        <span className="cal-day-row__name">{day}</span>
      </div>

      <div className="cal-day-row__ranges">
        {!enabled ? <span className="cal-day-row__unavailable">Unavailable</span> : null}
        {ranges.map((range, index) => (
          <div key={index} className="cal-day-row__range">
            <TimeSelect
              value={range.startTime}
              timeFormat={timeFormat}
              onChange={(value) =>
                onChange(ranges.map((item, itemIndex) => (itemIndex === index ? { ...item, startTime: value } : item)))
              }
            />
            <span className="cal-day-row__dash">-</span>
            <TimeSelect
              value={range.endTime}
              timeFormat={timeFormat}
              onChange={(value) =>
                onChange(ranges.map((item, itemIndex) => (itemIndex === index ? { ...item, endTime: value } : item)))
              }
            />
            {index === 0 ? null : (
              <IconButton
                icon="trash"
                label="Remove time range"
                variant="minimal"
                size="sm"
                onClick={() => onChange(ranges.filter((_item, itemIndex) => itemIndex !== index))}
              />
            )}
          </div>
        ))}
      </div>

      <div className="cal-day-row__actions">
        <IconButton icon="plus" label="Add time range" variant="minimal" size="sm" onClick={addRange} />
        <CopyTimesPopover day={day} disabled={!enabled} onCopy={onCopyTo} />
      </div>
    </div>
  );
}

function CopyTimesPopover({
  day,
  disabled,
  onCopy,
}: {
  day: WeekDayName;
  disabled: boolean;
  onCopy: (days: WeekDayName[]) => void;
}) {
  const [selected, setSelected] = useState<WeekDayName[]>([]);
  return (
    <Popover
      align="end"
      width={200}
      trigger={({ toggle, ref }) => (
        <button
          type="button"
          ref={ref as (node: HTMLButtonElement | null) => void}
          className="cal-copy-trigger"
          aria-label="Copy times to"
          title="Copy times to"
          disabled={disabled}
          onClick={toggle}
        >
          <Icon name="copy" size={14} />
        </button>
      )}
    >
      {({ close }) => (
        <div className="cal-copy-panel">
          <p className="cal-section-title">Copy times to</p>
          {WEEK_DAYS.filter((candidate) => candidate !== day).map((candidate) => (
            <Checkbox
              key={candidate}
              label={candidate}
              checked={selected.includes(candidate)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, candidate]
                    : current.filter((value) => value !== candidate)
                )
              }
            />
          ))}
          <Button
            size="sm"
            onClick={() => {
              onCopy(selected);
              setSelected([]);
              close();
            }}
          >
            Apply
          </Button>
        </div>
      )}
    </Popover>
  );
}

export interface OverrideEntry {
  date: string;
  startTime: string | null;
  endTime: string | null;
}

interface OverrideListProps {
  overrides: OverrideEntry[];
  timeFormat: 12 | 24;
  timeZone: string;
  onChange: (overrides: OverrideEntry[]) => void;
}

export function DateOverrideList({ overrides, timeFormat, timeZone, onChange }: OverrideListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const byDate = new Map<string, OverrideEntry[]>();
  for (const override of overrides) {
    byDate.set(override.date, [...(byDate.get(override.date) ?? []), override]);
  }
  const dates = [...byDate.keys()].sort();

  return (
    <div className="cal-overrides">
      <div className="cal-overrides__head">
        <div>
          <p className="cal-section-title">Date overrides</p>
          <p className="cal-hint">Change your hours or block a specific date.</p>
        </div>
      </div>

      <div className="cal-overrides__list">
        {dates.length === 0 ? <p className="cal-hint">No overrides yet.</p> : null}
        {dates.map((date) => {
          const entries = byDate.get(date) ?? [];
          const unavailable = entries.every((entry) => entry.startTime === null);
          return (
            <div key={date} className="cal-overrides__item">
              <div>
                <p className="cal-overrides__date">{formatDateISO(date, { weekday: "short" })}</p>
                {unavailable ? (
                  <Badge tone="error" startIcon="ban">
                    Unavailable
                  </Badge>
                ) : (
                  <p className="cal-hint">
                    {entries
                      .map(
                        (entry) =>
                          `${formatHHMM(entry.startTime as string, timeFormat)} - ${formatHHMM(
                            entry.endTime as string,
                            timeFormat
                          )}`
                      )
                      .join(", ")}
                  </p>
                )}
              </div>
              <IconButton
                icon="trash"
                label="Delete override"
                variant="minimal"
                size="sm"
                onClick={() => onChange(overrides.filter((entry) => entry.date !== date))}
              />
            </div>
          );
        })}
      </div>

      <Button variant="secondary" startIcon="plus" size="sm" onClick={() => setDialogOpen(true)}>
        Add an override
      </Button>

      <DateOverrideDialog
        open={dialogOpen}
        timeFormat={timeFormat}
        timeZone={timeZone}
        onClose={() => setDialogOpen(false)}
        onSave={(entries) => {
          const dates_ = new Set(entries.map((entry) => entry.date));
          onChange([...overrides.filter((entry) => !dates_.has(entry.date)), ...entries]);
          setDialogOpen(false);
        }}
      />
    </div>
  );
}

function DateOverrideDialog({
  open,
  onClose,
  onSave,
  timeFormat,
  timeZone,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (entries: OverrideEntry[]) => void;
  timeFormat: 12 | 24;
  timeZone: string;
}) {
  const [month, setMonth] = useState(() => `${todayISO(timeZone).slice(0, 7)}-01`);
  const [date, setDate] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [ranges, setRanges] = useState<TimeRange[]>([{ startTime: "09:00", endTime: "17:00" }]);

  const reset = (): void => {
    setDate(null);
    setUnavailable(false);
    setRanges([{ startTime: "09:00", endTime: "17:00" }]);
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Select the dates to override"
      width={620}
      footer={
        <>
          <Button
            variant="minimal"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={!date}
            onClick={() => {
              if (!date) return;
              onSave(
                unavailable
                  ? [{ date, startTime: null, endTime: null }]
                  : ranges.map((range) => ({ date, startTime: range.startTime, endTime: range.endTime }))
              );
              reset();
            }}
          >
            Add override
          </Button>
        </>
      }
    >
      <div className="cal-override-dialog">
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          selected={date}
          onSelect={setDate}
          timeZone={timeZone}
          minDate={todayISO(timeZone)}
        />
        <div className="cal-override-dialog__side">
          {date ? (
            <>
              <p className="cal-section-title">{formatDateISO(date)}</p>
              {unavailable ? (
                <p className="cal-hint">This date will be blocked entirely.</p>
              ) : (
                <div className="cal-override-dialog__ranges">
                  {ranges.map((range, index) => (
                    <div key={index} className="cal-day-row__range">
                      <TimeSelect
                        value={range.startTime}
                        timeFormat={timeFormat}
                        onChange={(value) =>
                          setRanges(
                            ranges.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, startTime: value } : item
                            )
                          )
                        }
                      />
                      <span className="cal-day-row__dash">-</span>
                      <TimeSelect
                        value={range.endTime}
                        timeFormat={timeFormat}
                        onChange={(value) =>
                          setRanges(
                            ranges.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, endTime: value } : item
                            )
                          )
                        }
                      />
                      {index > 0 ? (
                        <IconButton
                          icon="trash"
                          label="Remove range"
                          variant="minimal"
                          size="sm"
                          onClick={() =>
                            setRanges(ranges.filter((_item, itemIndex) => itemIndex !== index))
                          }
                        />
                      ) : null}
                    </div>
                  ))}
                  <Button
                    variant="minimal"
                    size="sm"
                    startIcon="plus"
                    onClick={() =>
                      setRanges([...ranges, { startTime: "18:00", endTime: "19:00" }])
                    }
                  >
                    Add time
                  </Button>
                </div>
              )}
              <Checkbox
                label="Mark unavailable (All day)"
                checked={unavailable}
                onChange={(event) => setUnavailable(event.target.checked)}
              />
            </>
          ) : (
            <p className="cal-hint">Pick a date to set different hours or block it out.</p>
          )}
          <button
            type="button"
            className="cal-override-dialog__jump"
            onClick={() => setMonth(addMonthsISO(month, 1))}
          >
            Next month <Icon name="chevronRight" size={12} />
          </button>
        </div>
      </div>
    </Dialog>
  );
}
