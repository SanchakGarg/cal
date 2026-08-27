import { formatTime } from "../lib/time.ts";
import { Skeleton } from "./Layout.tsx";
import "./TimeSlots.css";

export interface Slot {
  start: string;
  /** Attendee places left inside one booking, when the event offers seats. */
  seatsRemaining?: number;
  seatsTotal?: number;
  /** Hosts still free at this time, for round robin and managed events. */
  hostsAvailable?: number;
  hostsTotal?: number;
}

/**
 * What is left at this time, in the reader's terms. Seats are places in one
 * meeting; hosts are separate bookings that can still be made at the same time.
 */
export function capacityLabel(slot: Slot): string | null {
  if (slot.seatsRemaining !== undefined && slot.seatsTotal !== undefined) {
    if (slot.seatsRemaining <= 0) return "Full";
    return `${slot.seatsRemaining} of ${slot.seatsTotal} seats left`;
  }
  if (slot.hostsAvailable !== undefined && slot.hostsTotal !== undefined) {
    return `${slot.hostsAvailable}/${slot.hostsTotal} available`;
  }
  return null;
}

interface TimeSlotColumnProps {
  slots: Slot[];
  timeZone: string;
  timeFormat: 12 | 24;
  selected?: string | null;
  onSelect: (start: string) => void;
  loading?: boolean;
  emptyLabel?: string;
}

export function TimeSlotColumn({
  slots,
  timeZone,
  timeFormat,
  selected,
  onSelect,
  loading = false,
  emptyLabel = "No available times",
}: TimeSlotColumnProps) {
  if (loading) {
    return (
      <div className="cal-slots">
        {Array.from({ length: 6 }, (_unused, index) => (
          <Skeleton key={index} height={38} />
        ))}
      </div>
    );
  }

  if (slots.length === 0) {
    return <p className="cal-slots__empty">{emptyLabel}</p>;
  }

  return (
    <div className="cal-slots">
      {slots.map((slot) => (
        <button
          key={slot.start}
          type="button"
          className={`cal-slot ${selected === slot.start ? "is-selected" : ""}`}
          onClick={() => onSelect(slot.start)}
        >
          <span>{formatTime(new Date(slot.start), timeZone, timeFormat)}</span>
          {capacityLabel(slot) ? <span className="cal-slot__seats">{capacityLabel(slot)}</span> : null}
        </button>
      ))}
    </div>
  );
}
