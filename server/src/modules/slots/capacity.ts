// What a slot is allowed to say about how much room is left.
import type { EventTypeRow } from "../serialize.ts";

/**
 * What a slot may publish about how much room is left.
 *
 * `seats` counts attendees inside one booking; `hosts` counts how many hosts are
 * still free at that time, which is the round robin equivalent — two free hosts
 * means two people can still book that slot, one each. Collective events get
 * neither: every host attends, so "how many are free" is always all of them and
 * the number would say nothing.
 */
export function capacityKind(eventType: EventTypeRow): "seats" | "hosts" | null {
  if (!eventType.seats_show_availability_count) return null;
  if (eventType.seats_per_time_slot) return "seats";
  if (eventType.scheduling_type === "roundRobin" || eventType.scheduling_type === "managed") {
    return "hosts";
  }
  return null;
}

/** The capacity fields for one slot, or nothing when the event publishes none. */
export function capacityOf(
  slot: { hostIds: number[]; seatsRemaining?: number; seatsTotal?: number },
  kind: "seats" | "hosts" | null,
  hostCount: number
): Record<string, number> {
  if (kind === "seats" && slot.seatsRemaining !== undefined && slot.seatsTotal !== undefined) {
    return { seatsRemaining: slot.seatsRemaining, seatsTotal: slot.seatsTotal };
  }
  if (kind === "hosts" && hostCount > 1) {
    return { hostsAvailable: slot.hostIds.length, hostsTotal: hostCount };
  }
  return {};
}
