// Calendar links and ICS payloads for booking confirmation pages.

function stamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface CalendarEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  organizerEmail?: string;
  attendeeEmails?: string[];
}

export function buildIcs(event: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//cal-clone//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `LOCATION:${escapeText(event.location)}`,
  ];
  if (event.organizerEmail) lines.push(`ORGANIZER:mailto:${event.organizerEmail}`);
  for (const email of event.attendeeEmails ?? []) {
    lines.push(`ATTENDEE;RSVP=TRUE;CN=${email}:mailto:${email}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function calendarLinks(event: CalendarEvent): Record<string, string> {
  const google = new URL("https://calendar.google.com/calendar/r/eventedit");
  google.searchParams.set("text", event.title);
  google.searchParams.set("dates", `${stamp(event.start)}/${stamp(event.end)}`);
  google.searchParams.set("details", event.description);
  google.searchParams.set("location", event.location);

  const outlook = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
  outlook.searchParams.set("path", "/calendar/action/compose");
  outlook.searchParams.set("rru", "addevent");
  outlook.searchParams.set("subject", event.title);
  outlook.searchParams.set("startdt", event.start.toISOString());
  outlook.searchParams.set("enddt", event.end.toISOString());
  outlook.searchParams.set("body", event.description);
  outlook.searchParams.set("location", event.location);

  const office = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  office.search = outlook.search;

  return {
    google: google.toString(),
    microsoftOutlook: outlook.toString(),
    microsoftOffice: office.toString(),
    ics: `data:text/calendar;charset=utf8,${encodeURIComponent(buildIcs(event))}`,
  };
}
