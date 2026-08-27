// Row -> cal.com API v2 response shapes. Keeps SQL snake_case out of the API.

import { weekDayName } from "../http/validate.ts";

export interface UserRecord {
  id: number;
  username: string;
  email: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  time_zone: string;
  week_start: string;
  time_format: number;
  locale: string;
  default_schedule_id: number | null;
  organization_id: number | null;
  is_guest?: boolean;
  completed_onboarding?: boolean;
}

export function serializeMe(user: UserRecord, organization?: { id: number; slug: string | null } | null) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    bio: user.bio,
    timeFormat: user.time_format,
    defaultScheduleId: user.default_schedule_id,
    weekStart: user.week_start,
    timeZone: user.time_zone,
    locale: user.locale,
    organizationId: user.organization_id,
    isGuest: user.is_guest ?? false,
    completedOnboarding: user.completed_onboarding ?? false,
    ...(organization ? { organization: { id: organization.id, slug: organization.slug } } : {}),
  };
}

export interface ScheduleRow {
  id: number;
  user_id: number;
  name: string;
  time_zone: string;
  exclude_from_team?: boolean;
}

export interface AvailabilityRow {
  day: number;
  start_time: string;
  end_time: string;
}

export interface OverrideRow {
  date: string | Date;
  start_time: string | null;
  end_time: string | null;
}

const hhmm = (value: string): string => value.slice(0, 5);
const isoDate = (value: string | Date): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/** Availability rows are grouped so days sharing a range collapse into one entry. */
export function serializeSchedule(
  schedule: ScheduleRow,
  availability: AvailabilityRow[],
  overrides: OverrideRow[],
  defaultScheduleId: number | null
) {
  const grouped = new Map<string, { days: string[]; startTime: string; endTime: string }>();
  for (const row of availability) {
    const key = `${hhmm(row.start_time)}-${hhmm(row.end_time)}`;
    const entry = grouped.get(key) ?? {
      days: [],
      startTime: hhmm(row.start_time),
      endTime: hhmm(row.end_time),
    };
    entry.days.push(weekDayName(row.day));
    grouped.set(key, entry);
  }

  return {
    id: schedule.id,
    ownerId: schedule.user_id,
    name: schedule.name,
    timeZone: schedule.time_zone,
    availability: [...grouped.values()],
    isDefault: defaultScheduleId === schedule.id,
    /** When true, team events never draw availability from this schedule. */
    excludeFromTeam: schedule.exclude_from_team ?? false,
    overrides: overrides.map((override) => ({
      date: isoDate(override.date),
      startTime: override.start_time ? hhmm(override.start_time) : null,
      endTime: override.end_time ? hhmm(override.end_time) : null,
    })),
  };
}

export interface EventTypeRow {
  id: number;
  owner_id: number | null;
  team_id: number | null;
  parent_id: number | null;
  title: string;
  slug: string;
  description: string;
  length_in_minutes: number;
  length_in_minutes_options: number[] | null;
  schedule_id: number | null;
  slot_interval: number | null;
  minimum_booking_notice: number;
  before_event_buffer: number;
  after_event_buffer: number;
  offset_start: number;
  hidden: boolean;
  disable_guests: boolean;
  requires_booker_email_verification: boolean;
  lock_timezone_toggle: boolean;
  only_show_first_available_slot: boolean;
  hide_calendar_notes: boolean;
  hide_calendar_event_details: boolean;
  hide_organizer_email: boolean;
  success_redirect_url: string | null;
  custom_name: string | null;
  interface_language: string | null;
  allow_rescheduling_past_bookings: boolean;
  disable_cancelling: boolean;
  disable_rescheduling: boolean;
  scheduling_type: "collective" | "roundRobin" | "managed" | null;
  assign_all_team_members: boolean;
  seats_per_time_slot: number | null;
  seats_show_attendee_info: boolean;
  seats_show_availability_count: boolean;
  locations: unknown;
  booking_fields: unknown;
  booking_limits_count: unknown;
  booking_limits_duration: unknown;
  booker_active_bookings_limit: unknown;
  booking_window: unknown;
  booker_layouts: unknown;
  confirmation_policy: unknown;
  recurrence: unknown;
  color: unknown;
  email_settings: unknown;
  metadata: unknown;
}

export interface EventTypeHostRecord {
  userId: number;
  name: string;
  username: string;
  mandatory: boolean;
  priority: string;
  weight: number;
  avatarUrl: string | null;
}

export function serializeEventType(
  row: EventTypeRow,
  extras: {
    hosts?: EventTypeHostRecord[];
    ownerUsername?: string | null;
    teamSlug?: string | null;
    bookingUrlBase?: string;
  } = {}
) {
  const base = extras.bookingUrlBase ?? "";
  const owner = extras.teamSlug ? `team/${extras.teamSlug}` : extras.ownerUsername ?? "";
  return {
    id: row.id,
    ownerId: row.owner_id,
    teamId: row.team_id,
    parentId: row.parent_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    lengthInMinutes: row.length_in_minutes,
    lengthInMinutesOptions: row.length_in_minutes_options ?? undefined,
    scheduleId: row.schedule_id,
    slotInterval: row.slot_interval,
    minimumBookingNotice: row.minimum_booking_notice,
    beforeEventBuffer: row.before_event_buffer,
    afterEventBuffer: row.after_event_buffer,
    offsetStart: row.offset_start,
    hidden: row.hidden,
    disableGuests: row.disable_guests,
    requiresBookerEmailVerification: row.requires_booker_email_verification,
    lockTimeZoneToggleOnBookingPage: row.lock_timezone_toggle,
    onlyShowFirstAvailableSlot: row.only_show_first_available_slot,
    hideCalendarNotes: row.hide_calendar_notes,
    hideCalendarEventDetails: row.hide_calendar_event_details,
    hideOrganizerEmail: row.hide_organizer_email,
    successRedirectUrl: row.success_redirect_url,
    customName: row.custom_name,
    interfaceLanguage: row.interface_language,
    allowReschedulingPastBookings: row.allow_rescheduling_past_bookings,
    disableCancelling: row.disable_cancelling,
    disableRescheduling: row.disable_rescheduling,
    schedulingType: row.scheduling_type,
    assignAllTeamMembers: row.assign_all_team_members,
    seats: row.seats_per_time_slot
      ? {
          seatsPerTimeSlot: row.seats_per_time_slot,
          showAttendeeInfo: row.seats_show_attendee_info,
          showAvailabilityCount: row.seats_show_availability_count,
        }
      : { disabled: true },
    locations: row.locations ?? [],
    bookingFields: row.booking_fields ?? [],
    bookingLimitsCount: row.booking_limits_count ?? { disabled: true },
    bookingLimitsDuration: row.booking_limits_duration ?? { disabled: true },
    bookerActiveBookingsLimit: row.booker_active_bookings_limit ?? { disabled: true },
    bookingWindow: row.booking_window ?? { disabled: true },
    bookerLayouts: row.booker_layouts ?? undefined,
    confirmationPolicy: row.confirmation_policy ?? { disabled: true },
    recurrence: row.recurrence ?? { disabled: true },
    color: row.color ?? undefined,
    emailSettings: row.email_settings ?? undefined,
    metadata: row.metadata ?? {},
    hosts: extras.hosts ?? [],
    bookingUrl: owner ? `${base}/${owner}/${row.slug}` : null,
  };
}

export interface BookingRow {
  id: number;
  uid: string;
  event_type_id: number | null;
  user_id: number | null;
  title: string;
  description: string;
  start_time: Date;
  end_time: Date;
  status: string;
  location: string;
  meeting_url: string | null;
  cancellation_reason: string | null;
  cancelled_by_email: string | null;
  rescheduling_reason: string | null;
  rescheduled_by_email: string | null;
  rescheduled_from_uid: string | null;
  rescheduled_to_uid: string | null;
  recurring_event_uid: string | null;
  absent_host: boolean;
  ics_uid: string | null;
  rating: number | null;
  booking_fields_responses: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface BookingAttendeeRow {
  id: number;
  booking_id: number;
  name: string;
  email: string;
  time_zone: string;
  language: string;
  phone_number: string | null;
  no_show: boolean;
  seat_uid: string | null;
  is_guest: boolean;
}

export interface BookingHostRecord {
  id: number;
  name: string;
  email: string;
  username: string;
  timeZone: string;
}

export function serializeBooking(
  row: BookingRow,
  attendees: BookingAttendeeRow[],
  hosts: BookingHostRecord[],
  eventType?: { id: number; slug: string; title: string } | null
) {
  const durationMinutes = Math.round((row.end_time.getTime() - row.start_time.getTime()) / 60000);
  const guests = attendees.filter((attendee) => attendee.is_guest).map((attendee) => attendee.email);
  return {
    id: row.id,
    uid: row.uid,
    title: row.title,
    description: row.description,
    hosts,
    status: row.status,
    cancellationReason: row.cancellation_reason ?? undefined,
    cancelledByEmail: row.cancelled_by_email ?? undefined,
    reschedulingReason: row.rescheduling_reason ?? undefined,
    rescheduledByEmail: row.rescheduled_by_email ?? undefined,
    rescheduledFromUid: row.rescheduled_from_uid ?? undefined,
    rescheduledToUid: row.rescheduled_to_uid ?? undefined,
    recurringEventUid: row.recurring_event_uid ?? undefined,
    start: row.start_time.toISOString(),
    end: row.end_time.toISOString(),
    duration: durationMinutes,
    eventTypeId: row.event_type_id,
    eventType: eventType ? { id: eventType.id, slug: eventType.slug, title: eventType.title } : null,
    meetingUrl: row.meeting_url ?? undefined,
    location: row.location,
    absentHost: row.absent_host,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    metadata: row.metadata ?? {},
    rating: row.rating ?? undefined,
    icsUid: row.ics_uid ?? undefined,
    attendees: attendees
      .filter((attendee) => !attendee.is_guest)
      .map((attendee) => ({
        name: attendee.name,
        email: attendee.email,
        timeZone: attendee.time_zone,
        language: attendee.language,
        phoneNumber: attendee.phone_number ?? undefined,
        absent: attendee.no_show,
        seatUid: attendee.seat_uid ?? undefined,
      })),
    guests,
    bookingFieldsResponses: row.booking_fields_responses ?? {},
  };
}

export interface TeamRow {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string | null;
  logo_url: string | null;
  banner_url: string | null;
  bio: string | null;
  hide_branding: boolean;
  is_organization: boolean;
  is_private: boolean;
  hide_book_a_team_member: boolean;
  metadata: unknown;
  theme: string | null;
  brand_color: string | null;
  dark_brand_color: string | null;
  time_format: number;
  time_zone: string;
  week_start: string;
}

export function serializeTeam(row: TeamRow) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    bio: row.bio,
    hideBranding: row.hide_branding,
    isOrganization: row.is_organization,
    isPrivate: row.is_private,
    hideBookATeamMember: row.hide_book_a_team_member,
    metadata: row.metadata ?? {},
    theme: row.theme,
    brandColor: row.brand_color,
    darkBrandColor: row.dark_brand_color,
    timeFormat: row.time_format,
    timeZone: row.time_zone,
    weekStart: row.week_start,
  };
}

export interface MembershipRow {
  id: number;
  user_id: number;
  team_id: number;
  role: string;
  accepted: boolean;
  disable_impersonation: boolean;
  hide_personal_events?: boolean;
  user_name?: string;
  user_email?: string;
  user_username?: string;
  user_avatar_url?: string | null;
}

export function serializeMembership(row: MembershipRow) {
  return {
    id: row.id,
    userId: row.user_id,
    teamId: row.team_id,
    role: row.role,
    accepted: row.accepted,
    disableImpersonation: row.disable_impersonation,
    /** The member's own choice to keep their events off the team page. */
    hidePersonalEvents: row.hide_personal_events ?? false,
    user:
      row.user_email === undefined
        ? undefined
        : {
            id: row.user_id,
            name: row.user_name ?? "",
            email: row.user_email,
            username: row.user_username ?? "",
            avatarUrl: row.user_avatar_url ?? null,
          },
  };
}

export interface OooRow {
  id: number;
  uuid: string;
  user_id: number;
  start_date: string | Date;
  end_date: string | Date;
  reason: string;
  notes: string | null;
  to_user_id: number | null;
}

export function serializeOoo(row: OooRow) {  
  return {
    id: row.id,
    uuid: row.uuid,
    userId: row.user_id,
    start: isoDate(row.start_date),
    end: isoDate(row.end_date),
    reason: row.reason,
    notes: row.notes,
    toUserId: row.to_user_id,
  };
}

export interface WebhookRow {
  id: number;
  uid: string;
  user_id: number | null;
  team_id: number | null;
  event_type_id: number | null;
  subscriber_url: string;
  active: boolean;
  triggers: string[];
  secret: string | null;
  payload_template: string | null;
  time: number | null;
  time_unit: string | null;
}

export function serializeWebhook(row: WebhookRow) {
  return {
    id: row.uid,
    webhookId: row.id,
    userId: row.user_id,
    teamId: row.team_id,
    eventTypeId: row.event_type_id,
    subscriberUrl: row.subscriber_url,
    active: row.active,
    triggers: row.triggers,
    secret: row.secret,
    payloadTemplate: row.payload_template,
    time: row.time,
    timeUnit: row.time_unit,
  };
}

export interface PrivateLinkRow {
  id: number;
  link_id: string;
  event_type_id: number;
  expires_at: Date | null;
  max_usage_count: number | null;
  usage_count: number;
}

export function serializePrivateLink(row: PrivateLinkRow, bookingUrl: string | null) {
  return {
    linkId: row.link_id,
    eventTypeId: row.event_type_id,
    bookingUrl,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    maxUsageCount: row.max_usage_count,
    usageCount: row.usage_count,
    isExpired:
      (row.expires_at !== null && row.expires_at.getTime() < Date.now()) ||
      (row.max_usage_count !== null && row.usage_count >= row.max_usage_count),
  };
}
