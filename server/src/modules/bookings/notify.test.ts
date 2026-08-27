import assert from "node:assert/strict";
import { test } from "node:test";
import { mailRecipients } from "./notify.ts";

type Booking = Parameters<typeof mailRecipients>[0];

/** The parts of a serialized booking the recipient list actually reads. */
function booking(overrides: Record<string, unknown> = {}): Booking {
  return {
    attendees: [{ name: "Grace Hopper", email: "grace@example.com", timeZone: "Europe/London" }],
    guests: [],
    hosts: [{ name: "Ada Lovelace", email: "ada@example.com", timeZone: "Asia/Kolkata" }],
    ...overrides,
  } as unknown as Booking;
}

test("attendees and hosts are all told, each in their own zone", () => {
  const list = mailRecipients(booking());
  assert.deepEqual(
    list.map((person) => [person.email, person.timeZone]),
    [
      ["grace@example.com", "Europe/London"],
      ["ada@example.com", "Asia/Kolkata"],
    ]
  );
});

test("a host who booked their own event is mailed once", () => {
  const list = mailRecipients(
    booking({
      attendees: [{ name: "Ada", email: "ada@example.com", timeZone: "Asia/Kolkata" }],
      hosts: [{ name: "Ada Lovelace", email: "ada@example.com", timeZone: "Asia/Kolkata" }],
    })
  );
  assert.equal(list.length, 1);
});

test("addresses differing only in case are the same person", () => {
  const list = mailRecipients(
    booking({
      attendees: [{ name: "Grace", email: "Grace@Example.com", timeZone: "Europe/London" }],
      guests: ["grace@example.com"],
      hosts: [],
    })
  );
  assert.equal(list.length, 1);
  // The first spelling seen wins, so the name we know is kept.
  assert.equal(list[0].name, "Grace");
});

test("guests are included and read the attendee's zone", () => {
  const list = mailRecipients(booking({ guests: ["someone@example.com"] }));
  const guest = list.find((person) => person.email === "someone@example.com");
  assert.ok(guest, "guest is mailed");
  assert.equal(guest.timeZone, "Europe/London");
});

test("a guest on a booking with no attendee still gets a usable zone", () => {
  const list = mailRecipients(booking({ attendees: [], guests: ["someone@example.com"], hosts: [] }));
  assert.equal(list.length, 1);
  assert.equal(list[0].timeZone, "Asia/Kolkata");
});

test("an empty zone is replaced by the app default, never left blank", () => {
  const list = mailRecipients(
    booking({ attendees: [{ name: "Grace", email: "grace@example.com", timeZone: "" }], hosts: [] })
  );
  assert.equal(list[0].timeZone, "Asia/Kolkata");
});

test("missing addresses are skipped rather than mailed", () => {
  const list = mailRecipients(
    booking({
      attendees: [
        { name: "No Address", email: "", timeZone: "Europe/London" },
        { name: "Grace", email: "grace@example.com", timeZone: "Europe/London" },
      ],
      hosts: [],
    })
  );
  assert.deepEqual(
    list.map((person) => person.email),
    ["grace@example.com"]
  );
});

test("a booking with nobody on it produces no mail", () => {
  assert.deepEqual(mailRecipients(booking({ attendees: [], guests: [], hosts: [] })), []);
});
