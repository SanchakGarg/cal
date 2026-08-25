import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventTypeRow } from "../serialize.ts";
import { validateBookingFields } from "./service.ts";

function eventTypeWith(fields: Array<Record<string, unknown>>): EventTypeRow {
  return { booking_fields: fields } as unknown as EventTypeRow;
}

const dropdown = {
  type: "select",
  slug: "topic",
  label: "Topic",
  required: true,
  options: ["Pricing", "Demo"],
};

const checkboxes = {
  type: "checkbox",
  slug: "areas",
  label: "Areas",
  required: false,
  options: ["Design", "Build", "Ship"],
  minSelections: 2,
  maxSelections: 3,
};

test("a required question must be answered", () => {
  assert.throws(
    () => validateBookingFields(eventTypeWith([dropdown]), {}),
    /bookingFieldsResponses.topic is required/
  );
});

test("an answer outside the option list is rejected", () => {
  assert.throws(
    () => validateBookingFields(eventTypeWith([dropdown]), { topic: "Something else" }),
    /must be one of Pricing, Demo/
  );
});

test("a single-answer question rejects an array of answers", () => {
  assert.throws(
    () => validateBookingFields(eventTypeWith([dropdown]), { topic: ["Pricing", "Demo"] }),
    /accepts a single answer/
  );
});

test("multi-answer questions enforce the selection bounds", () => {
  const eventType = eventTypeWith([checkboxes]);
  assert.throws(
    () => validateBookingFields(eventType, { areas: ["Design"] }),
    /needs at least 2 selection/
  );
  assert.deepEqual(validateBookingFields(eventType, { areas: ["Design", "Ship"] }), {
    areas: ["Design", "Ship"],
  });
});

test("multi-answer questions reject a repeated option", () => {
  assert.throws(
    () => validateBookingFields(eventTypeWith([checkboxes]), { areas: ["Design", "Design"] }),
    /must not repeat an option/
  );
});

test("ratings must be a whole number within range", () => {
  const eventType = eventTypeWith([
    { type: "rating", slug: "score", label: "Score", required: true, maxRating: 5 },
  ]);
  assert.throws(() => validateBookingFields(eventType, { score: 9 }), /between 1 and 5/);
  assert.throws(() => validateBookingFields(eventType, { score: 2.5 }), /between 1 and 5/);
  assert.deepEqual(validateBookingFields(eventType, { score: "4" }), { score: 4 });
});

test("date and time answers must be well formed", () => {
  const eventType = eventTypeWith([
    { type: "date", slug: "when", label: "When", required: false },
    { type: "time", slug: "at", label: "At", required: false },
  ]);
  assert.throws(() => validateBookingFields(eventType, { when: "24/08/2026" }), /2026-08-24/);
  assert.throws(() => validateBookingFields(eventType, { at: "25:00" }), /14:30/);
  assert.deepEqual(validateBookingFields(eventType, { when: "2026-08-24", at: "14:30" }), {
    when: "2026-08-24",
    at: "14:30",
  });
});

test("an empty array counts as no answer for a required question", () => {
  assert.throws(
    () => validateBookingFields(eventTypeWith([{ ...checkboxes, required: true }]), { areas: [] }),
    /bookingFieldsResponses.areas is required/
  );
});

test("extra responses are kept but capped", () => {
  const responses: Record<string, unknown> = { topic: "Demo" };
  for (let index = 0; index < 50; index += 1) responses[`junk${index}`] = index;
  const validated = validateBookingFields(eventTypeWith([dropdown]), responses);
  assert.equal(validated.topic, "Demo");
  assert.ok(Object.keys(validated).length <= 11, "extra keys are bounded");
});
