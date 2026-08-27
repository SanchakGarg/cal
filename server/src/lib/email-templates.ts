// Email bodies. Mail clients are a decade behind browsers, so everything here is
// inline-styled, table-free where possible, and paired with a plain-text version
// that reads well on its own.
import { env } from "../env.ts";
import { DEFAULT_TIME_ZONE } from "./tz.ts";
import type { Mail } from "./mail.ts";

// Light values are inlined on every element, because that is the only styling
// some clients keep. The dark set is applied from a <style> block with
// !important, which is the only way to beat an inline style.
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const PAPER = "#f9fafb";
const CARD = "#ffffff";

const DARK_PAGE = "#0d0d0d";
const DARK_CARD = "#161616";
const DARK_INK = "#f4f4f5";
const DARK_MUTED = "#a1a1aa";
const DARK_LINE = "#2a2a2a";
const DARK_PANEL = "#1f1f1f";

/** Escapes text before it goes into an HTML body. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PersonLike {
  name: string;
  email: string;
}

export interface BookingMailData {
  /**
   * The event as the customer chose it — "Intro call" — rather than the internal
   * booking title, which reads "Intro call between Ada and Grace".
   */
  eventName: string;
  /** The event type's own description, if the host wrote one. */
  description?: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  location?: string | null;
  meetingUrl?: string | null;
  hosts: PersonLike[];
  uid: string;
  reason?: string | null;
  previousStart?: Date | null;
}

/** "Thursday, 27 August 2026" in the reader's own zone. */
function longDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function clock(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function timeRange(data: BookingMailData): string {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  return `${clock(data.start, zone)} – ${clock(data.end, zone)}`;
}

/**
 * One shell for every message. `accent` tints the rule above the card and the
 * status line, so a confirmation, a change and a cancellation are told apart
 * before a word is read — no emoji needed to do that job.
 *
 * Dark mode is opt-in per client: the meta tags say the message handles both,
 * and the media query re-states every colour with !important because inline
 * styles otherwise win.
 */
function shell(options: {
  heading: string;
  preheader: string;
  accent: string;
  status: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<style>
  @media (prefers-color-scheme: dark) {
    .cal-page { background: ${DARK_PAGE} !important; }
    .cal-card { background: ${DARK_CARD} !important; border-color: ${DARK_LINE} !important; }
    .cal-ink { color: ${DARK_INK} !important; }
    .cal-muted { color: ${DARK_MUTED} !important; }
    .cal-rule { border-color: ${DARK_LINE} !important; }
    .cal-panel { background: ${DARK_PANEL} !important; color: ${DARK_INK} !important; }
    .cal-foot { background: ${DARK_PANEL} !important; border-color: ${DARK_LINE} !important; }
    .cal-btn { background: ${DARK_INK} !important; color: ${DARK_PAGE} !important; }
    .cal-link { color: ${DARK_INK} !important; }
  }
</style>
</head>
<body class="cal-page cal-ink" style="margin:0;padding:24px 12px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(
    options.preheader
  )}</span>
  <div class="cal-card" style="max-width:520px;margin:0 auto;background:${CARD};border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
    <div style="height:3px;background:${options.accent};"></div>
    <div style="padding:28px 28px 8px;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${
        options.accent
      };">${esc(options.status)}</p>
      <h1 class="cal-ink" style="margin:0;font-size:22px;line-height:1.3;letter-spacing:-0.02em;font-weight:700;color:${INK};">${esc(
        options.heading
      )}</h1>
    </div>
    <div style="padding:0 28px 28px;">
      ${options.body}
    </div>
    <div class="cal-foot" style="padding:14px 28px;border-top:1px solid ${LINE};background:${PAPER};font-size:12px;">
      <span class="cal-muted" style="color:${MUTED};">Sent by Cal · </span><a class="cal-link" href="${
        env.webOrigin
      }" style="color:${MUTED};text-decoration:none;">${esc(
        env.webOrigin.replace(/^https?:\/\//, "")
      )}</a>
    </div>
  </div>
</body>
</html>`;
}

/** Whole minutes between the two ends of the booking. */
function durationLabel(data: BookingMailData): string {
  const minutes = Math.round((data.end.getTime() - data.start.getTime()) / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} minutes`;
}

/**
 * The details block, written for the person who did the booking. It carries what
 * they need to turn up and nothing about how the booking is hosted — no team or
 * organisation name, no event-type mechanics, no host email addresses.
 */
function detailRows(data: BookingMailData, options: { omitWhen?: boolean } = {}): string {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  const rows: Array<[string, string]> = [["Event", esc(data.eventName)]];
  // A reschedule request has no "when" yet — that is the whole point of it.
  if (!options.omitWhen) {
    rows.push([
      "When",
      `${esc(longDate(data.start, zone))}<br />${esc(timeRange(data))} <span class="cal-muted" style="color:${MUTED};">(${esc(zone)})</span>`,
    ]);
  }
  rows.push(["Duration", esc(durationLabel(data))]);
  if (data.hosts.length > 0) {
    rows.push([data.hosts.length === 1 ? "With" : "Hosts", data.hosts.map((host) => esc(host.name)).join(", ")]);
  }
  if (data.location) rows.push(["Where", esc(data.location)]);
  // A reference is what a customer quotes back when they write in about it.
  rows.push(["Reference", `<span style="font-family:ui-monospace,monospace;">${esc(data.uid)}</span>`]);

  return `<table class="cal-rule" role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">
    ${rows
      .map(
        ([label, value]) => `<tr>
      <td class="cal-muted" style="padding:10px 12px 10px 0;font-size:13px;color:${MUTED};vertical-align:top;width:88px;">${label}</td>
      <td class="cal-ink" style="padding:10px 0;font-size:14px;color:${INK};font-weight:500;">${value}</td>
    </tr>`
      )
      .join("")}
  </table>`;
}

/** The host's description of the event, when there is one. */
function descriptionBlock(data: BookingMailData): string {
  if (!data.description) return "";
  return `<div class="cal-panel" style="margin:0 0 18px;padding:14px;border-radius:12px;background:${PAPER};font-size:14px;line-height:1.6;color:${INK};">${esc(
    data.description
  )}</div>`;
}

function button(href: string, label: string): string {
  return `<a class="cal-btn" href="${esc(href)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${INK};color:${CARD};font-size:14px;font-weight:600;text-decoration:none;">${esc(
    label
  )}</a>`;
}

function textDetails(data: BookingMailData, options: { omitWhen?: boolean } = {}): string {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  const lines = [`Event:     ${data.eventName}`];
  if (!options.omitWhen) {
    lines.push(`When:      ${longDate(data.start, zone)}, ${timeRange(data)} (${zone})`);
  }
  lines.push(`Duration:  ${durationLabel(data)}`);
  if (data.hosts.length > 0) {
    lines.push(`With:      ${data.hosts.map((host) => host.name).join(", ")}`);
  }
  if (data.location) lines.push(`Where:     ${data.location}`);
  lines.push(`Reference: ${data.uid}`);
  return lines.join("\n");
}

const bookingUrl = (uid: string): string => `${env.webOrigin}/booking/${uid}`;

/**
 * Confirmation of a booking, addressed to the person who made it. States what it
 * is in the first line, then the details — no greeting, and nothing about who
 * else was notified.
 */
export function bookingConfirmedMail(data: BookingMailData, pending: boolean): Omit<Mail, "to"> {
  const heading = pending ? "We have received your booking request" : "Your booking is confirmed";
  const opener = pending
    ? "This is confirmation that your booking request has been received. It needs to be approved before it is final, and you will get a further email once it is."
    : "This is confirmation of your booking. The details are below.";

  return {
    subject: pending
      ? `Booking request received — ${data.eventName}`
      : `Booking confirmed — ${data.eventName}`,
    html: shell({
      heading,
      preheader: `${longDate(data.start, data.timeZone || DEFAULT_TIME_ZONE)}, ${timeRange(data)}`,
      accent: pending ? "#b45309" : "#047857",
      status: pending ? "Awaiting approval" : "Confirmed",
      body: `<p class="cal-muted" style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">${opener}</p>
        ${detailRows(data)}
        ${descriptionBlock(data)}
        ${
          data.meetingUrl && !pending
            ? `<p class="cal-ink" style="margin:0 0 18px;font-size:14px;">Join here: <a href="${esc(data.meetingUrl)}" class="cal-link" style="color:${INK};">${esc(
                data.meetingUrl
              )}</a></p>`
            : ""
        }
        ${button(bookingUrl(data.uid), "View, reschedule or cancel")}
        <p class="cal-muted" style="margin:18px 0 0;font-size:12px;color:${MUTED};">Use that link if you need to change or cancel this booking.</p>`,
    }),
    text: `${heading}

${opener}

${textDetails(data)}
${data.description ? `\n${data.description}\n` : ""}${
      data.meetingUrl && !pending ? `\nJoin: ${data.meetingUrl}\n` : ""
    }
View, reschedule or cancel: ${bookingUrl(data.uid)}`,
  };
}

/** The booking moved to a new time. */
export function bookingRescheduledMail(data: BookingMailData): Omit<Mail, "to"> {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  const was = data.previousStart
    ? `<p class="cal-muted" style="margin:8px 0 0;font-size:13px;color:${MUTED};text-decoration:line-through;">${esc(
        `${longDate(data.previousStart, zone)}, ${clock(data.previousStart, zone)}`
      )}</p>`
    : "";

  return {
    subject: `Booking moved — ${data.eventName}`,
    html: shell({
      heading: "Your booking has been moved",
      preheader: `Now ${longDate(data.start, zone)}, ${timeRange(data)}`,
      accent: "#1d4ed8",
      status: "Time changed",
      body: `<p class="cal-muted" style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">This booking has moved to a new time. The updated details are below.</p>
        ${was}
        ${detailRows(data)}
        ${data.reason ? `<p class="cal-muted" style="margin:0 0 18px;font-size:14px;color:${MUTED};">Reason: ${esc(data.reason)}</p>` : ""}
        ${button(bookingUrl(data.uid), "View the new time")}`,
    }),
    text: `Your booking has been moved

This booking has moved to a new time. The updated details are below.
${data.previousStart ? `\nPrevious time: ${longDate(data.previousStart, zone)}, ${clock(data.previousStart, zone)}\n` : ""}
${textDetails(data)}
${data.reason ? `\nReason: ${data.reason}\n` : ""}
View the new time: ${bookingUrl(data.uid)}`,
  };
}

/** The booking is off. */
export function bookingCancelledMail(data: BookingMailData, declined: boolean): Omit<Mail, "to"> {
  const heading = declined ? "Your booking was not approved" : "Your booking is cancelled";
  const opener = declined
    ? "This booking could not be approved, so it will not go ahead. The time is free to book again."
    : "This booking has been cancelled and will not go ahead. The time is free to book again.";
  return {
    subject: `Booking cancelled — ${data.eventName}`,
    html: shell({
      heading,
      preheader: `${longDate(data.start, data.timeZone || DEFAULT_TIME_ZONE)} is no longer going ahead`,
      accent: "#b91c1c",
      status: declined ? "Not approved" : "Cancelled",
      body: `<p class="cal-muted" style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">${opener}</p>
        ${detailRows(data)}
        ${data.reason ? `<p class="cal-muted" style="margin:0 0 18px;font-size:14px;color:${MUTED};">Reason: ${esc(data.reason)}</p>` : ""}
        ${button(env.webOrigin, "Book another time")}`,
    }),
    text: `${heading}

${opener}

${textDetails(data)}
${data.reason ? `\nReason: ${data.reason}\n` : ""}
Book another time: ${env.webOrigin}`,
  };
}

/**
 * The host cannot move a booking on someone else's behalf without knowing what
 * suits them, so a reschedule request asks the person who booked to pick a new
 * time. The original slot is already released by the time this goes out.
 */
export function rescheduleRequestMail(data: BookingMailData): Omit<Mail, "to"> {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  const original = `${longDate(data.start, zone)}, ${clock(data.start, zone)}`;

  return {
    subject: `Please pick a new time — ${data.eventName}`,
    html: shell({
      heading: "Could you choose another time?",
      preheader: `${data.eventName} on ${original} needs a new time`,
      accent: "#b45309",
      status: "New time needed",
      body: `<p class="cal-muted" style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">
          The host has asked to move this booking. Your original time has been released, so please
          choose one that works for you.
        </p>
        <p class="cal-muted" style="margin:8px 0 0;font-size:13px;color:${MUTED};text-decoration:line-through;">${esc(
          original
        )}</p>
        ${detailRows(data, { omitWhen: true })}
        ${
          data.reason
            ? `<div class="cal-panel" style="margin:0 0 18px;padding:14px;border-radius:12px;background:${PAPER};font-size:14px;line-height:1.6;color:${INK};"><strong>Reason given:</strong> ${esc(
                data.reason
              )}</div>`
            : ""
        }
        ${button(`${env.webOrigin}/reschedule/${data.uid}`, "Pick a new time")}
        <p class="cal-muted" style="margin:18px 0 0;font-size:12px;color:${MUTED};">
          If none of the times offered suit you, reply to this email and the host will sort it out
          with you directly.
        </p>`,
    }),
    text: `Could you choose another time?

The host has asked to move this booking. Your original time has been released, so please choose one that works for you.

Original time: ${original}

${textDetails(data, { omitWhen: true })}
${data.reason ? `\nReason given: ${data.reason}\n` : ""}
Pick a new time: ${env.webOrigin}/reschedule/${data.uid}`,
  };
}

/** Someone was added to a team. */
export function teamInviteMail(input: {
  teamName: string;
  inviterName: string;
  inviteeEmail: string;
  /** Present when the invitee has no account yet. */
  token?: string;
  existingUser: boolean;
}): Omit<Mail, "to"> {
  const link = input.token
    ? `${env.webOrigin}/auth/login?invite=${encodeURIComponent(input.token)}`
    : `${env.webOrigin}/teams`;
  const action = input.existingUser ? "Open your teams" : "Accept the invite";

  return {
    subject: `${input.inviterName} added you to ${input.teamName}`,
    html: shell({
      heading: `Welcome to ${input.teamName}`,
      preheader: `${input.inviterName} wants you on the team`,
      accent: "#6d28d9",
      status: "Invitation",
      body: `<p class="cal-muted" style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${MUTED};">
          <strong style="color:${INK};">${esc(input.inviterName)}</strong> added you to
          <strong style="color:${INK};">${esc(input.teamName)}</strong>. You can now be booked as a
          host on the team's event types, and their bookings will show up alongside your own.
        </p>
        ${button(link, action)}
        ${
          input.token
            ? `<p class="cal-muted" style="margin:18px 0 0;font-size:12px;color:${MUTED};">If the button doesn't work, use this invite code: <code style="background:${PAPER};padding:2px 5px;border-radius:4px;">${esc(
                input.token
              )}</code></p>`
            : ""
        }`,
    }),
    text: `Welcome to ${input.teamName}

${input.inviterName} added you to ${input.teamName}. You can now be booked as a host on the team's event types.

${action}: ${link}
${input.token ? `\nInvite code: ${input.token}\n` : ""}`,
  };
}

/** A brand new account. */
export function welcomeMail(input: { name: string; username: string }): Omit<Mail, "to"> {
  const link = `${env.webOrigin}/${input.username}`;
  const first = input.name.split(" ")[0] || input.name;

  return {
    subject: "Your Cal booking page is ready",
    html: shell({
      heading: `Hi ${first}, your booking page is live`,
      preheader: "Share your link and let people pick a time",
      accent: "#047857",
      status: "Welcome",
      body: `<p class="cal-muted" style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${MUTED};">
          No more "does Tuesday work?" — send people your link and they'll pick a time that's
          genuinely free.
        </p>
        <div style="margin:0 0 18px;padding:14px;border:1px solid ${LINE};border-radius:10px;background:${PAPER};font-size:15px;font-weight:600;color:${INK};">
          ${esc(link.replace(/^https?:\/\//, ""))}
        </div>
        <p class="cal-muted" style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${MUTED};">
          Worth doing next: set your working hours, connect your calendar so real conflicts are
          respected, and create an event type for the kind of meeting you take most.
        </p>
        ${button(`${env.webOrigin}/event-types`, "Set up your first event")}`,
    }),
    text: `Hi ${first}, your booking page is live

Your link: ${link}

Next: set your working hours, connect your calendar, and create an event type.

${env.webOrigin}/event-types`,
  };
}
