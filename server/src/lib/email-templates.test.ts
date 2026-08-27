import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookingCancelledMail,
  bookingConfirmedMail,
  bookingRescheduledMail,
  teamInviteMail,
  welcomeMail,
  type BookingMailData,
} from "./email-templates.ts";

function booking(overrides: Partial<BookingMailData> = {}): BookingMailData {
  return {
    title: "Product design review",
    // 05:00 UTC is 10:30 in Kolkata, which makes a timezone mistake obvious.
    start: new Date("2026-08-27T05:00:00.000Z"),
    end: new Date("2026-08-27T05:30:00.000Z"),
    timeZone: "Asia/Kolkata",
    location: "Cal Video",
    meetingUrl: null,
    hosts: [{ name: "Ada Lovelace", email: "ada@example.com" }],
    attendeeName: "Grace Hopper",
    uid: "bk_123",
    reason: null,
    previousStart: null,
    ...overrides,
  };
}

test("a confirmed booking is announced as booked, not requested", () => {
  const mail = bookingConfirmedMail(booking(), false);
  assert.equal(mail.subject, "Confirmed: Product design review");
  assert.match(mail.html, /booked in<\/h1>/);
  assert.doesNotMatch(mail.html, /awaiting confirmation/i);
});

test("a pending booking says it is awaiting the host", () => {
  const mail = bookingConfirmedMail(booking(), true);
  assert.equal(mail.subject, "Requested: Product design review");
  assert.match(mail.html, /awaiting confirmation/i);
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
      title: '<script>alert("x")</script>',
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
  assert.equal(mail.subject, "Moved: Product design review");
  assert.match(mail.html, /Tuesday, 25 August 2026/);
  assert.match(mail.html, /line-through/);
  assert.match(mail.html, /Board meeting/);
});

test("a cancellation says the slot is free again, and carries the reason", () => {
  const mail = bookingCancelledMail(booking({ reason: "No longer needed" }), false);
  assert.equal(mail.subject, "Cancelled: Product design review");
  assert.match(mail.html, /free to book again/);
  assert.match(mail.html, /No longer needed/);
  assert.match(mail.text, /No longer needed/);
});

test("a host declining reads differently from an attendee cancelling", () => {
  const declined = bookingCancelledMail(booking(), true);
  const cancelled = bookingCancelledMail(booking(), false);
  assert.notEqual(declined.html, cancelled.html);
  assert.match(declined.html, /make it work<\/h1>/);
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
