import assert from "node:assert/strict";
import { test } from "node:test";
import { capacityKind, capacityOf } from "./capacity.ts";

/** Only the fields `capacityKind` reads. */
function eventType(overrides: Record<string, unknown> = {}) {
  return {
    seats_show_availability_count: true,
    seats_per_time_slot: null,
    scheduling_type: null,
    ...overrides,
  } as Parameters<typeof capacityKind>[0];
}

test("seats win when the event offers them", () => {
  assert.equal(capacityKind(eventType({ seats_per_time_slot: 3 })), "seats");
  // Even on a round robin: places in the booking are the tighter constraint.
  assert.equal(
    capacityKind(eventType({ seats_per_time_slot: 3, scheduling_type: "roundRobin" })),
    "seats"
  );
});

test("round robin and managed events count free hosts", () => {
  assert.equal(capacityKind(eventType({ scheduling_type: "roundRobin" })), "hosts");
  assert.equal(capacityKind(eventType({ scheduling_type: "managed" })), "hosts");
});

test("a collective event publishes no host count", () => {
  // Every host attends, so the count is always all of them and says nothing.
  assert.equal(capacityKind(eventType({ scheduling_type: "collective" })), null);
});

test("a plain personal event publishes nothing", () => {
  assert.equal(capacityKind(eventType()), null);
});

test("the host's toggle turns every count off", () => {
  assert.equal(
    capacityKind(eventType({ seats_show_availability_count: false, seats_per_time_slot: 3 })),
    null
  );
  assert.equal(
    capacityKind(eventType({ seats_show_availability_count: false, scheduling_type: "roundRobin" })),
    null
  );
});

test("seat counts are published as remaining out of total", () => {
  const slot = { hostIds: [1], seatsRemaining: 2, seatsTotal: 5 };
  assert.deepEqual(capacityOf(slot, "seats", 1), { seatsRemaining: 2, seatsTotal: 5 });
});

test("host counts are published as free out of all hosts", () => {
  const slot = { hostIds: [1, 2] };
  assert.deepEqual(capacityOf(slot, "hosts", 3), { hostsAvailable: 2, hostsTotal: 3 });
});

test("a single-host round robin publishes nothing, because 1/1 is noise", () => {
  assert.deepEqual(capacityOf({ hostIds: [1] }, "hosts", 1), {});
});

test("asking for seats on a slot that carries none publishes nothing", () => {
  assert.deepEqual(capacityOf({ hostIds: [1] }, "seats", 1), {});
});

test("no capacity kind means no fields at all", () => {
  assert.deepEqual(capacityOf({ hostIds: [1, 2], seatsRemaining: 1, seatsTotal: 2 }, null, 2), {});
});
