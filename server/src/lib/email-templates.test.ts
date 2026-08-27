import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookingCancelledMail,
  bookingConfirmedMail,
  bookingRescheduledMail,
  rescheduleRequestMail,
  teamInviteMail,
  welcomeMail,
  type BookingMailData,
} from "./email-templates.ts";

function booking(overrides: Partial<BookingMailData> = {}): BookingMailData {
  return {
    eventName: "Product design review",
    description: null,
    // 05:00 UTC is 10:30 in Kolkata, which makes a timezone mistake obvious.
    start: new Date("2026-08-27T05:00:00.000Z"),
    end: new Date("2026-08-27T05:30:00.000Z"),
    timeZone: "Asia/Kolkata",
    location: "Cal Video",
    meetingUrl: null,
    hosts: [{ name: "Ada Lovelace", email: "ada@example.com" }],
    uid: "bk_123",
    reason: null,
    previousStart: null,
    ...overrides,
  };
}

test("a confirmed booking is announced as booked, not requested", () => {
  const mail = bookingConfirmedMail(booking(), false);
  assert.equal(mail.subject, "Booking confirmed — Product design review");
  assert.match(mail.html, /Your booking is confirmed<\/h1>/);
  assert.doesNotMatch(mail.html, /needs to be approved/i);
});

test("a pending booking says it is awaiting the host", () => {
  const mail = bookingConfirmedMail(booking(), true);
  assert.equal(mail.subject, "Booking request received — Product design review");
  assert.match(mail.html, /needs to be approved/i);
});

test("the confirmation opens with what it is, not a greeting", () => {
  const mail = bookingConfirmedMail(booking(), false);
  assert.match(mail.html, /This is confirmation of your booking/);
  // A greeting built from a booking name reads badly the moment someone types
  // something that is not a name into the field.
  assert.doesNotMatch(mail.html, /Thanks/i);
  assert.doesNotMatch(mail.text, /Thanks/i);
});

test("nothing tells the customer who else was notified", () => {
  const mail = bookingConfirmedMail(booking(), false);
  assert.doesNotMatch(mail.html, /everyone/i);
  assert.doesNotMatch(mail.html, /has been told/i);
});

test("the event details a customer needs are all present", () => {
  const mail = bookingConfirmedMail(
    booking({ description: "Bring the latest mockups." }),
    false
  );
  for (const label of ["Event", "When", "Duration", "Where"]) {
    assert.match(mail.html, new RegExp(`>${label}</td>`), label);
  }
  assert.match(mail.html, /30 minutes/);
  // The booking reference is deliberately not shown to the customer.
  assert.doesNotMatch(mail.html, />Reference</);
  assert.match(mail.html, /Bring the latest mockups\./);
});

test("an event with no description simply omits the block", () => {
  const mail = bookingConfirmedMail(booking({ description: null }), false);
  assert.match(mail.html, />Event<\/td>/);
  assert.doesNotMatch(mail.text, /\n\n\n/);
});

test("durations over an hour read as hours", () => {
  const ninety = bookingConfirmedMail(
    booking({ end: new Date("2026-08-27T06:30:00.000Z") }),
    false
  );
  assert.match(ninety.html, /1 hour 30 minutes/);

  const exact = bookingConfirmedMail(
    booking({ end: new Date("2026-08-27T07:00:00.000Z") }),
    false
  );
  assert.match(exact.html, /2 hours/);
  assert.doesNotMatch(exact.html, /2 hours 0 minutes/);
});

test("times render in the recipient's own zone", () => {
  const kolkata = bookingConfirmedMail(booking(), false);
  assert.match(kolkata.html, /10:30/);
  assert.match(kolkata.html, /Thursday, 27 August 2026/);

  const newYork = bookingConfirmedMail(booking({ timeZone: "America/New_York" }), false);
  // The same instant is the previous evening in New York.
  assert.match(newYork.html, /01:00/);
  assert.match(newYork.html, /Thursday, 27 August 2026/);
  assert.match(newYork.html, /America\/New_York/);
});

test("a missing zone falls back to the app default rather than rendering blank", () => {
  const mail = bookingConfirmedMail(booking({ timeZone: "" }), false);
  assert.match(mail.html, /Asia\/Kolkata/);
});

test("attacker-supplied text cannot inject markup into the body", () => {
  const mail = bookingConfirmedMail(
    booking({
      eventName: '<script>alert("x")</script>',
      hosts: [{ name: `<img src=x onerror='steal()'>`, email: "a@example.com" }],
      location: '"><b>bold</b>',
    }),
    false
  );
  // The payloads survive as visible text; what must not survive is a live tag.
  assert.doesNotMatch(mail.html, /<script/i);
  assert.doesNotMatch(mail.html, /<img/i);
  assert.doesNotMatch(mail.html, /<b>bold<\/b>/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.html, /&lt;img src=x onerror=&#39;steal\(\)&#39;&gt;/);
});

test("a url is escaped before it reaches an href attribute", () => {
  const mail = bookingConfirmedMail(
    booking({ meetingUrl: 'https://evil.test/" onmouseover="steal()' }),
    false
  );
  // The quote that would have closed the attribute is encoded, so the injected
  // handler stays inside the href value instead of becoming its own attribute.
  assert.doesNotMatch(mail.html, /"\s+onmouseover=/);
  assert.match(mail.html, /&quot; onmouseover=/);
});

test("both a text and an html body are always produced", () => {
  for (const mail of [
    bookingConfirmedMail(booking(), false),
    bookingRescheduledMail(booking({ previousStart: new Date("2026-08-25T09:00:00.000Z") })),
    bookingCancelledMail(booking(), false),
    teamInviteMail({
      teamName: "Acme",
      inviterName: "Ada",
      inviteeEmail: "g@example.com",
      existingUser: true,
    }),
    welcomeMail({ name: "Grace Hopper", username: "grace" }),
  ]) {
    assert.ok(mail.subject.length > 0, "subject");
    assert.ok(mail.text.trim().length > 0, "text body");
    assert.match(mail.html, /^<!doctype html>/);
  }
});

test("a reschedule shows the time it moved away from", () => {
  const mail = bookingRescheduledMail(
    booking({ previousStart: new Date("2026-08-25T09:00:00.000Z"), reason: "Board meeting" })
  );
  assert.equal(mail.subject, "Booking moved — Product design review");
  assert.match(mail.html, /Tuesday, 25 August 2026/);
  assert.match(mail.html, /line-through/);
  assert.match(mail.html, /Board meeting/);
});

test("a cancellation says the slot is free again, and carries the reason", () => {
  const mail = bookingCancelledMail(booking({ reason: "No longer needed" }), false);
  assert.equal(mail.subject, "Booking cancelled — Product design review");
  assert.match(mail.html, /free to book again/);
  assert.match(mail.html, /No longer needed/);
  assert.match(mail.text, /No longer needed/);
});

test("a host declining reads differently from an attendee cancelling", () => {
  const declined = bookingCancelledMail(booking(), true);
  const cancelled = bookingCancelledMail(booking(), false);
  assert.notEqual(declined.html, cancelled.html);
  assert.match(declined.html, /was not approved<\/h1>/);
});

test("a reschedule request asks for a new time and never states the old one as When", () => {
  const mail = rescheduleRequestMail(booking({ reason: "Clashes with the board meeting" }));
  assert.equal(mail.subject, "Please pick a new time — Product design review");
  assert.match(mail.html, /choose another time/i);
  assert.match(mail.html, /Clashes with the board meeting/);
  assert.match(mail.text, /Clashes with the board meeting/);
  // The released time appears once, struck through — not as a live "When" row.
  assert.doesNotMatch(mail.html, />When<\/td>/);
  assert.doesNotMatch(mail.text, /^When:/m);
  assert.match(mail.html, /line-through/);
  assert.match(mail.html, /\/reschedule\/bk_123/);
});

test("a reschedule request with no reason given simply omits it", () => {
  const mail = rescheduleRequestMail(booking({ reason: null }));
  assert.doesNotMatch(mail.html, /Reason given/);
  assert.match(mail.html, /choose another time/i);
});

test("no template carries an emoji", () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  for (const mail of [
    bookingConfirmedMail(booking(), false),
    bookingConfirmedMail(booking(), true),
    bookingRescheduledMail(booking({ previousStart: new Date("2026-08-25T09:00:00.000Z") })),
    bookingCancelledMail(booking(), false),
    rescheduleRequestMail(booking()),
    teamInviteMail({ teamName: "Acme", inviterName: "Ada", inviteeEmail: "g@e.com", existingUser: true }),
    welcomeMail({ name: "Grace", username: "grace" }),
  ]) {
    assert.doesNotMatch(mail.subject, emoji, mail.subject);
    assert.doesNotMatch(mail.html, emoji);
    assert.doesNotMatch(mail.text, emoji);
  }
});

test("every template declares dark mode and restates its colours", () => {
  for (const mail of [bookingConfirmedMail(booking(), false), welcomeMail({ name: "G", username: "g" })]) {
    assert.match(mail.html, /name="color-scheme" content="light dark"/);
    assert.match(mail.html, /prefers-color-scheme: dark/);
    // Inline styles only lose to !important, so the dark block must use it.
    assert.match(mail.html, /background: #0d0d0d !important/);
  }
});

test("an invite to someone without an account carries the token", () => {
  const mail = teamInviteMail({
    teamName: "Acme",
    inviterName: "Ada Lovelace",
    inviteeEmail: "g@example.com",
    token: "tok_abc123",
    existingUser: false,
  });
  assert.equal(mail.subject, "Ada Lovelace added you to Acme");
  assert.match(mail.html, /tok_abc123/);
  assert.match(mail.text, /tok_abc123/);
  assert.match(mail.html, /Accept the invite/);
});

test("an invite to an existing user links to their teams and leaks no token", () => {
  const mail = teamInviteMail({
    teamName: "Acme",
    inviterName: "Ada Lovelace",
    inviteeEmail: "g@example.com",
    existingUser: true,
  });
  assert.match(mail.html, /Open your teams/);
  assert.doesNotMatch(mail.html, /invite code/i);
});

test("the welcome mail greets by first name and shows the booking link", () => {
  const mail = welcomeMail({ name: "Grace Hopper", username: "grace" });
  assert.match(mail.html, /Hi Grace,/);
  assert.match(mail.text, /\/grace/);
});

test("a one-word name still greets cleanly", () => {
  const mail = welcomeMail({ name: "Grace", username: "grace" });
  assert.match(mail.html, /Hi Grace,/);
});
