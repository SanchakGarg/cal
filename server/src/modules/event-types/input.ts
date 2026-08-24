// Maps the cal.com CreateEventTypeInput_2024_06_14 payload onto our columns.

import { badRequest } from "../../http/errors.ts";
import {
  type Json,
  array,
  asObject,
  dateISO,
  int,
  oneOf,
  optArray,
  optBool,
  optInt,
  optStr,
  slugify,
  str,
} from "../../http/validate.ts";

export interface EventTypeColumns {
  title?: string;
  slug?: string;
  description?: string;
  length_in_minutes?: number;
  length_in_minutes_options?: number[] | null;
  schedule_id?: number | null;
  slot_interval?: number | null;
  minimum_booking_notice?: number;
  before_event_buffer?: number;
  after_event_buffer?: number;
  offset_start?: number;
  hidden?: boolean;
  disable_guests?: boolean;
  requires_booker_email_verification?: boolean;
  lock_timezone_toggle?: boolean;
  only_show_first_available_slot?: boolean;
  hide_calendar_notes?: boolean;
  hide_calendar_event_details?: boolean;
  hide_organizer_email?: boolean;
  success_redirect_url?: string | null;
  custom_name?: string | null;
  interface_language?: string | null;
  allow_rescheduling_past_bookings?: boolean;
  disable_cancelling?: boolean;
  disable_rescheduling?: boolean;
  scheduling_type?: "collective" | "roundRobin" | "managed" | null;
  assign_all_team_members?: boolean;
  seats_per_time_slot?: number | null;
  seats_show_attendee_info?: boolean;
  seats_show_availability_count?: boolean;
  locations?: unknown;
  booking_fields?: unknown;
  booking_limits_count?: unknown;
  booking_limits_duration?: unknown;
  booker_active_bookings_limit?: unknown;
  booking_window?: unknown;
  booker_layouts?: unknown;
  confirmation_policy?: unknown;
  recurrence?: unknown;
  color?: unknown;
  email_settings?: unknown;
  metadata?: unknown;
}

export interface HostInput {
  userId: number;
  mandatory: boolean;
  priority: "lowest" | "low" | "medium" | "high" | "highest";
  weight: number;
}

const LOCATION_TYPES = [
  "address",
  "link",
  "integration",
  "phone",
  "attendeeAddress",
  "attendeePhone",
  "attendeeDefined",
  "organizersDefaultApp",
] as const;

const INTEGRATIONS = ["cal-video", "google-meet", "zoom", "office365-video", "jitsi"] as const;

const BOOKING_FIELD_TYPES = [
  "name",
  "splitName",
  "email",
  "title",
  "location",
  "notes",
  "guests",
  "rescheduleReason",
  "phone",
  "address",
  "text",
  "number",
  "textarea",
  "select",
  "multiselect",
  "multiemail",
  "checkbox",
  "radio",
  "boolean",
  "url",
] as const;

const OPTION_FIELD_TYPES = new Set(["select", "multiselect", "checkbox", "radio"]);

function parseLocations(raw: unknown[]): unknown[] {
  return raw.map((entry, index) => {
    const item = asObject(entry, `locations[${index}]`);
    const type = oneOf(item, "type", LOCATION_TYPES, true);
    switch (type) {
      case "address":
        return { type, address: str(item, "address"), public: optBool(item, "public") ?? true };
      case "link":
        return { type, link: str(item, "link"), public: optBool(item, "public") ?? true };
      case "integration":
        return { type, integration: oneOf(item, "integration", INTEGRATIONS, true) };
      case "phone":
        return { type, phone: str(item, "phone"), public: optBool(item, "public") ?? true };
      default:
        return { type };
    }
  });
}

function parseBookingFields(raw: unknown[]): unknown[] {
  const slugs = new Set<string>();
  return raw.map((entry, index) => {
    const item = asObject(entry, `bookingFields[${index}]`);
    const type = oneOf(item, "type", BOOKING_FIELD_TYPES, true);
    const isSystem = ["name", "splitName", "email", "title", "location", "notes", "guests", "rescheduleReason"].includes(
      type
    );
    const slug = isSystem ? (optStr(item, "slug") ?? type) : str(item, "slug", { max: 64 });
    if (slugs.has(slug)) throw badRequest(`bookingFields[${index}].slug "${slug}" is duplicated`);
    slugs.add(slug);

    const field: Json = {
      type,
      slug,
      label: optStr(item, "label", { max: 200 }) ?? null,
      required: optBool(item, "required") ?? isSystem,
      placeholder: optStr(item, "placeholder", { max: 200 }) ?? null,
      hidden: optBool(item, "hidden") ?? false,
      disableOnPrefill: optBool(item, "disableOnPrefill") ?? false,
    };
    if (OPTION_FIELD_TYPES.has(type)) {
      const options = array(item, "options", { required: true }).map((option, optionIndex) => {
        if (typeof option !== "string" || option.trim() === "") {
          throw badRequest(`bookingFields[${index}].options[${optionIndex}] must be a string`);
        }
        return option;
      });
      field.options = options;
    }
    return field;
  });
}

/** cal.com sends either the shape or `{ disabled: true }`; we store null for disabled. */
function parseDisableable<T>(value: unknown, label: string, parse: (body: Json) => T): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const body = asObject(value, label);
  if (body.disabled === true) return null;
  return parse(body);
}

function parseLimits(body: Json): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const period of ["day", "week", "month", "year"] as const) {
    const value = optInt(body, period, { min: 1 });
    if (value !== undefined) limits[period] = value;
  }
  if (Object.keys(limits).length === 0) throw badRequest("At least one limit period is required");
  return limits;
}

export function parseEventTypeInput(
  raw: unknown,
  opts: { partial?: boolean; team?: boolean } = {}
): { columns: EventTypeColumns; hosts?: HostInput[] } {
  const body = asObject(raw);
  const partial = opts.partial ?? false;
  const columns: EventTypeColumns = {};

  if (!partial || body.title !== undefined) {
    columns.title = str(body, "title", { max: 200 });
  }
  if (!partial || body.slug !== undefined) {
    const slug = slugify(partial ? str(body, "slug") : str(body, "slug"));
    if (!slug) throw badRequest("slug must contain at least one alphanumeric character");
    columns.slug = slug;
  }
  if (!partial || body.lengthInMinutes !== undefined) {
    columns.length_in_minutes = int(body, "lengthInMinutes", { min: 1, max: 1440 });
  }

  const set = <K extends keyof EventTypeColumns>(key: K, value: EventTypeColumns[K]): void => {
    if (value !== undefined) columns[key] = value;
  };

  set("description", optStr(body, "description", { max: 5000 }));
  set("slot_interval", optInt(body, "slotInterval", { min: 5, max: 1440 }));
  set("minimum_booking_notice", optInt(body, "minimumBookingNotice", { min: 0 }));
  set("before_event_buffer", optInt(body, "beforeEventBuffer", { min: 0 }));
  set("after_event_buffer", optInt(body, "afterEventBuffer", { min: 0 }));
  set("offset_start", optInt(body, "offsetStart", { min: 0 }));
  set("schedule_id", optInt(body, "scheduleId"));
  set("hidden", optBool(body, "hidden"));
  set("disable_guests", optBool(body, "disableGuests"));
  set("requires_booker_email_verification", optBool(body, "requiresBookerEmailVerification"));
  set("lock_timezone_toggle", optBool(body, "lockTimeZoneToggleOnBookingPage"));
  set("only_show_first_available_slot", optBool(body, "onlyShowFirstAvailableSlot"));
  set("hide_calendar_notes", optBool(body, "hideCalendarNotes"));
  set("hide_calendar_event_details", optBool(body, "hideCalendarEventDetails"));
  set("hide_organizer_email", optBool(body, "hideOrganizerEmail"));
  set("success_redirect_url", optStr(body, "successRedirectUrl", { max: 500 }));
  set("custom_name", optStr(body, "customName", { max: 200 }));
  set("interface_language", optStr(body, "interfaceLanguage", { max: 10 }));
  set("allow_rescheduling_past_bookings", optBool(body, "allowReschedulingPastBookings"));
  set("disable_cancelling", optBool(body, "disableCancelling"));
  set("disable_rescheduling", optBool(body, "disableRescheduling"));
  set("assign_all_team_members", optBool(body, "assignAllTeamMembers"));

  const durations = optArray(body, "lengthInMinutesOptions");
  if (durations) {
    columns.length_in_minutes_options = durations.map((value, index) => {
      if (typeof value !== "number" || value < 1) {
        throw badRequest(`lengthInMinutesOptions[${index}] must be a positive number`);
      }
      return value;
    });
  }

  const locations = optArray(body, "locations");
  if (locations) columns.locations = JSON.stringify(parseLocations(locations));

  const bookingFields = optArray(body, "bookingFields");
  if (bookingFields) columns.booking_fields = JSON.stringify(parseBookingFields(bookingFields));

  const limitsCount = parseDisableable(body.bookingLimitsCount, "bookingLimitsCount", parseLimits);
  if (limitsCount !== undefined) {
    columns.booking_limits_count = limitsCount === null ? null : JSON.stringify(limitsCount);
  }

  const limitsDuration = parseDisableable(
    body.bookingLimitsDuration,
    "bookingLimitsDuration",
    parseLimits
  );
  if (limitsDuration !== undefined) {
    columns.booking_limits_duration = limitsDuration === null ? null : JSON.stringify(limitsDuration);
  }

  const activeLimit = parseDisableable(
    body.bookerActiveBookingsLimit,
    "bookerActiveBookingsLimit",
    (value) => ({ maximumActiveBookingsCount: int(value, "maximumActiveBookingsCount", { min: 1 }) })
  );
  if (activeLimit !== undefined) {
    columns.booker_active_bookings_limit = activeLimit === null ? null : JSON.stringify(activeLimit);
  }

  const window = parseDisableable(body.bookingWindow, "bookingWindow", (value) => {
    const type = oneOf(value, "type", ["businessDays", "calendarDays", "range"] as const, true);
    if (type === "range") {
      const range = array(value, "value", { required: true });
      if (range.length !== 2) throw badRequest("bookingWindow.value must be [startDate, endDate]");
      return {
        type,
        startDate: dateISO(range[0], "bookingWindow.value[0]"),
        endDate: dateISO(range[1], "bookingWindow.value[1]"),
      };
    }
    return {
      type,
      value: int(value, "value", { min: 1, max: 730 }),
      rolling: optBool(value, "rolling") ?? true,
    };
  });
  if (window !== undefined) {
    columns.booking_window = window === null ? null : JSON.stringify(window);
  }

  const layouts = body.bookerLayouts;
  if (layouts !== undefined) {
    if (layouts === null) {
      columns.booker_layouts = null;
    } else {
      const value = asObject(layouts, "bookerLayouts");
      const enabled = array(value, "enabledLayouts", { required: true }).map((layout, index) => {
        if (!["month", "week", "column"].includes(String(layout))) {
          throw badRequest(`bookerLayouts.enabledLayouts[${index}] must be month, week or column`);
        }
        return String(layout);
      });
      columns.booker_layouts = JSON.stringify({
        defaultLayout: oneOf(value, "defaultLayout", ["month", "week", "column"] as const, true),
        enabledLayouts: enabled,
      });
    }
  }

  const confirmation = parseDisableable(body.confirmationPolicy, "confirmationPolicy", (value) => {
    const type = oneOf(value, "type", ["always", "time"] as const, true);
    const policy: Json = {
      type,
      blockUnconfirmedBookingsInBooker: optBool(value, "blockUnconfirmedBookingsInBooker") ?? true,
    };
    if (type === "time") {
      const threshold = asObject(value.noticeThreshold, "confirmationPolicy.noticeThreshold");
      policy.noticeThreshold = {
        count: int(threshold, "count", { min: 0 }),
        unit: oneOf(threshold, "unit", ["minutes", "hours"] as const, true),
      };
    }
    return policy;
  });
  if (confirmation !== undefined) {
    columns.confirmation_policy = confirmation === null ? null : JSON.stringify(confirmation);
  }

  const recurrence = parseDisableable(body.recurrence, "recurrence", (value) => ({
    interval: int(value, "interval", { min: 1, max: 20 }),
    occurrences: int(value, "occurrences", { min: 1, max: 100 }),
    frequency: oneOf(value, "frequency", ["yearly", "monthly", "weekly"] as const, true),
  }));
  if (recurrence !== undefined) {
    columns.recurrence = recurrence === null ? null : JSON.stringify(recurrence);
  }

  const seats = parseDisableable(body.seats, "seats", (value) => ({
    seatsPerTimeSlot: int(value, "seatsPerTimeSlot", { min: 1, max: 1000 }),
    showAttendeeInfo: optBool(value, "showAttendeeInfo") ?? false,
    showAvailabilityCount: optBool(value, "showAvailabilityCount") ?? true,
  }));
  if (seats !== undefined) {
    if (seats === null) {
      columns.seats_per_time_slot = null;
    } else {
      columns.seats_per_time_slot = seats.seatsPerTimeSlot;
      columns.seats_show_attendee_info = seats.showAttendeeInfo;
      columns.seats_show_availability_count = seats.showAvailabilityCount;
    }
  }

  if (body.color !== undefined) {
    if (body.color === null) {
      columns.color = null;
    } else {
      const value = asObject(body.color, "color");
      columns.color = JSON.stringify({
        lightThemeHex: str(value, "lightThemeHex", { max: 7 }),
        darkThemeHex: str(value, "darkThemeHex", { max: 7 }),
      });
    }
  }

  if (body.emailSettings !== undefined) {
    const value = asObject(body.emailSettings, "emailSettings");
    columns.email_settings = JSON.stringify({
      disableEmailsToAttendees: optBool(value, "disableEmailsToAttendees") ?? false,
      disableEmailsToHosts: optBool(value, "disableEmailsToHosts") ?? false,
    });
  }

  if (opts.team) {
    const schedulingType = oneOf(
      body,
      "schedulingType",
      ["collective", "roundRobin", "managed"] as const,
      !partial as true
    );
    if (schedulingType) columns.scheduling_type = schedulingType;
  }

  const rawHosts = optArray(body, "hosts");
  const hosts = rawHosts?.map((entry, index) => {
    const item = asObject(entry, `hosts[${index}]`);
    return {
      userId: int(item, "userId"),
      mandatory: optBool(item, "mandatory") ?? false,
      priority:
        oneOf(item, "priority", ["lowest", "low", "medium", "high", "highest"] as const) ?? "medium",
      weight: optInt(item, "weight", { min: 0, max: 1000 }) ?? 100,
    };
  });

  return { columns, hosts };
}

export const DEFAULT_BOOKING_FIELDS = [
  { type: "name", slug: "name", label: null, required: true, placeholder: null, hidden: false },
  { type: "email", slug: "email", label: null, required: true, placeholder: null, hidden: false },
  { type: "location", slug: "location", label: null, required: false, placeholder: null, hidden: false },
  { type: "notes", slug: "notes", label: null, required: false, placeholder: null, hidden: false },
  { type: "guests", slug: "guests", label: null, required: false, placeholder: null, hidden: false },
];
