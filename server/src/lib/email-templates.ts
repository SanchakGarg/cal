// Email bodies. Mail clients are a decade behind browsers, so everything here is
// inline-styled, table-free where possible, and paired with a plain-text version
// that reads well on its own.
import { env } from "../env.ts";
import { DEFAULT_TIME_ZONE } from "./tz.ts";
import type { Mail } from "./mail.ts";

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const PAPER = "#f9fafb";

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
  title: string;
  start: Date;
  end: Date;
  timeZone: string;
  location?: string | null;
  meetingUrl?: string | null;
  hosts: PersonLike[];
  attendeeName: string;
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
 * One shell for every message: a small header, a body, and a signature. `accent`
 * tints the header rule so confirmations, changes and cancellations are
 * distinguishable at a glance without needing to be read.
 */
function shell(options: {
  heading: string;
  preheader: string;
  accent: string;
  emoji: string;
  body: string;
}): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:24px 12px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(
    options.preheader
  )}</span>
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
    <div style="height:4px;background:${options.accent};"></div>
    <div style="padding:28px;">
      <div style="font-size:30px;line-height:1;margin-bottom:12px;">${options.emoji}</div>
      <h1 style="margin:0 0 6px;font-size:21px;line-height:1.3;letter-spacing:-0.02em;color:${INK};">${esc(
        options.heading
      )}</h1>
      ${options.body}
    </div>
    <div style="padding:14px 28px;border-top:1px solid ${LINE};background:${PAPER};font-size:12px;color:${MUTED};">
      Sent by Cal · <a href="${env.webOrigin}" style="color:${MUTED};">${esc(
        env.webOrigin.replace(/^https?:\/\//, "")
      )}</a>
    </div>
  </div>
</body>
</html>`;
}

/** The when/who/where block shared by all booking mails. */
function detailRows(data: BookingMailData): string {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  const rows: Array<[string, string]> = [
    ["What", esc(data.title)],
    ["When", `${esc(longDate(data.start, zone))}<br />${esc(timeRange(data))} <span style="color:${MUTED};">(${esc(zone)})</span>`],
  ];
  if (data.hosts.length > 0) {
    rows.push(["Who", data.hosts.map((host) => esc(host.name)).join(", ")]);
  }
  if (data.location) rows.push(["Where", esc(data.location)]);

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">
    ${rows
      .map(
        ([label, value]) => `<tr>
      <td style="padding:10px 12px 10px 0;font-size:13px;color:${MUTED};vertical-align:top;width:70px;">${label}</td>
      <td style="padding:10px 0;font-size:14px;color:${INK};font-weight:500;">${value}</td>
    </tr>`
      )
      .join("")}
  </table>`;
}

function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:${INK};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${esc(
    label
  )}</a>`;
}

function textDetails(data: BookingMailData): string {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  const lines = [
    `What:  ${data.title}`,
    `When:  ${longDate(data.start, zone)}, ${timeRange(data)} (${zone})`,
  ];
  if (data.hosts.length > 0) lines.push(`Who:   ${data.hosts.map((host) => host.name).join(", ")}`);
  if (data.location) lines.push(`Where: ${data.location}`);
  return lines.join("\n");
}

const bookingUrl = (uid: string): string => `${env.webOrigin}/booking/${uid}`;

/** A new booking is on the calendar. */
export function bookingConfirmedMail(data: BookingMailData, pending: boolean): Omit<Mail, "to"> {
  const heading = pending ? "Almost there — awaiting confirmation" : "You're booked in";
  const opener = pending
    ? `Thanks ${esc(data.attendeeName)}! We've asked the host to confirm. We'll email you the moment they do.`
    : `Thanks ${esc(data.attendeeName)}! It's on the calendar and everyone has been told.`;

  return {
    subject: pending ? `Requested: ${data.title}` : `Confirmed: ${data.title}`,
    html: shell({
      heading,
      preheader: `${longDate(data.start, data.timeZone || DEFAULT_TIME_ZONE)} at ${timeRange(data)}`,
      accent: pending ? "#f59e0b" : "#10b981",
      emoji: pending ? "🌱" : "🎉",
      body: `<p style="margin:0;font-size:14px;line-height:1.6;color:${MUTED};">${opener}</p>
        ${detailRows(data)}
        ${data.meetingUrl ? `<p style="margin:0 0 18px;font-size:14px;">Join here: <a href="${esc(data.meetingUrl)}" style="color:${INK};">${esc(data.meetingUrl)}</a></p>` : ""}
        ${button(bookingUrl(data.uid), "View or reschedule")}
        <p style="margin:18px 0 0;font-size:12px;color:${MUTED};">Plans change — you can reschedule or cancel from that link any time.</p>`,
    }),
    text: `${heading}

Thanks ${data.attendeeName}!${pending ? " We've asked the host to confirm." : " It's on the calendar."}

${textDetails(data)}
${data.meetingUrl ? `\nJoin: ${data.meetingUrl}\n` : ""}
View or reschedule: ${bookingUrl(data.uid)}`,
  };
}

/** The booking moved to a new time. */
export function bookingRescheduledMail(data: BookingMailData): Omit<Mail, "to"> {
  const zone = data.timeZone || DEFAULT_TIME_ZONE;
  const was = data.previousStart
    ? `<p style="margin:0 0 4px;font-size:13px;color:${MUTED};text-decoration:line-through;">${esc(
        `${longDate(data.previousStart, zone)}, ${clock(data.previousStart, zone)}`
      )}</p>`
    : "";

  return {
    subject: `Moved: ${data.title}`,
    html: shell({
      heading: "New time, same meeting",
      preheader: `Now ${longDate(data.start, zone)} at ${timeRange(data)}`,
      accent: "#3b82f6",
      emoji: "🕰️",
      body: `<p style="margin:0;font-size:14px;line-height:1.6;color:${MUTED};">This meeting has been moved. Here's where it landed.</p>
        ${was}
        ${detailRows(data)}
        ${data.reason ? `<p style="margin:0 0 18px;font-size:14px;color:${MUTED};">Reason: ${esc(data.reason)}</p>` : ""}
        ${button(bookingUrl(data.uid), "View the new time")}`,
    }),
    text: `New time, same meeting

${data.previousStart ? `Was: ${longDate(data.previousStart, zone)}, ${clock(data.previousStart, zone)}\n` : ""}
${textDetails(data)}
${data.reason ? `\nReason: ${data.reason}\n` : ""}
View: ${bookingUrl(data.uid)}`,
  };
}

/** The booking is off. */
export function bookingCancelledMail(data: BookingMailData, declined: boolean): Omit<Mail, "to"> {
  const heading = declined ? "The host couldn't make it work" : "This meeting is cancelled";
  return {
    subject: `Cancelled: ${data.title}`,
    html: shell({
      heading,
      preheader: `${longDate(data.start, data.timeZone || DEFAULT_TIME_ZONE)} is no longer happening`,
      accent: "#ef4444",
      emoji: "🍂",
      body: `<p style="margin:0;font-size:14px;line-height:1.6;color:${MUTED};">The time has been released, so the slot is free to book again.</p>
        ${detailRows(data)}
        ${data.reason ? `<p style="margin:0 0 18px;font-size:14px;color:${MUTED};">Reason: ${esc(data.reason)}</p>` : ""}
        ${button(env.webOrigin, "Find another time")}`,
    }),
    text: `${heading}

The time has been released, so the slot is free to book again.

${textDetails(data)}
${data.reason ? `\nReason: ${data.reason}\n` : ""}
Find another time: ${env.webOrigin}`,
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
      accent: "#8b5cf6",
      emoji: "🎪",
      body: `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${MUTED};">
          <strong style="color:${INK};">${esc(input.inviterName)}</strong> added you to
          <strong style="color:${INK};">${esc(input.teamName)}</strong>. You can now be booked as a
          host on the team's event types, and their bookings will show up alongside your own.
        </p>
        ${button(link, action)}
        ${
          input.token
            ? `<p style="margin:18px 0 0;font-size:12px;color:${MUTED};">If the button doesn't work, use this invite code: <code style="background:${PAPER};padding:2px 5px;border-radius:4px;">${esc(
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
    subject: "Welcome to Cal 👋",
    html: shell({
      heading: `Hi ${first}, your booking page is live`,
      preheader: "Share your link and let people pick a time",
      accent: "#10b981",
      emoji: "🌤️",
      body: `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${MUTED};">
          No more "does Tuesday work?" — send people your link and they'll pick a time that's
          genuinely free.
        </p>
        <div style="margin:0 0 18px;padding:14px;border:1px solid ${LINE};border-radius:10px;background:${PAPER};font-size:15px;font-weight:600;color:${INK};">
          ${esc(link.replace(/^https?:\/\//, ""))}
        </div>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${MUTED};">
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
