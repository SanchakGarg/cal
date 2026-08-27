export interface Me {
  id: number;
  username: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  timeFormat: number;
  defaultScheduleId: number | null;
  weekStart: string;
  timeZone: string;
  locale: string;
  organizationId: number | null;
  isGuest: boolean;
  completedOnboarding: boolean;
  organization?: { id: number; slug: string | null };
}

export interface AvailabilityBlock {
  days: string[];
  startTime: string;
  endTime: string;
}

export interface DateOverride {
  date: string;
  startTime: string | null;
  endTime: string | null;
}

export interface Schedule {
  id: number;
  ownerId: number;
  name: string;
  timeZone: string;
  availability: AvailabilityBlock[];
  isDefault: boolean;
  overrides: DateOverride[];
}

export interface EventTypeHost {
  userId: number;
  name: string;
  username: string;
  mandatory: boolean;
  priority: string;
  weight: number;
  avatarUrl: string | null;
}

export interface EventTypeLocation {
  type: string;
  integration?: string;
  link?: string;
  address?: string;
  phone?: string;
  public?: boolean;
}

export interface BookingField {
  type: string;
  slug: string;
  label: string | null;
  required: boolean;
  placeholder: string | null;
  hidden: boolean;
  /** Answer choices for select/multiselect/radio/checkbox questions. */
  options?: string[];
  /** Bounds for the multi-answer types (multiselect, checkbox). */
  minSelections?: number;
  maxSelections?: number;
  /** Highest value a `rating` question accepts. */
  maxRating?: number;
}

export interface Disableable {
  disabled?: boolean;
}

export interface EventType {
  id: number;
  ownerId: number | null;
  teamId: number | null;
  parentId: number | null;
  title: string;
  slug: string;
  description: string;
  lengthInMinutes: number;
  lengthInMinutesOptions?: number[];
  scheduleId: number | null;
  slotInterval: number | null;
  minimumBookingNotice: number;
  beforeEventBuffer: number;
  afterEventBuffer: number;
  offsetStart: number;
  hidden: boolean;
  disableGuests: boolean;
  requiresBookerEmailVerification: boolean;
  lockTimeZoneToggleOnBookingPage: boolean;
  onlyShowFirstAvailableSlot: boolean;
  hideCalendarNotes: boolean;
  hideCalendarEventDetails: boolean;
  hideOrganizerEmail: boolean;
  successRedirectUrl: string | null;
  customName: string | null;
  interfaceLanguage: string | null;
  allowReschedulingPastBookings: boolean;
  disableCancelling: boolean;
  disableRescheduling: boolean;
  schedulingType: "collective" | "roundRobin" | "managed" | null;
  assignAllTeamMembers: boolean;
  seats: { seatsPerTimeSlot?: number; showAttendeeInfo?: boolean; showAvailabilityCount?: boolean } & Disableable;
  locations: EventTypeLocation[];
  bookingFields: BookingField[];
  bookingLimitsCount: (Record<string, number> & Disableable) | null;
  bookingLimitsDuration: (Record<string, number> & Disableable) | null;
  bookingWindow: ({ type?: string; value?: number; rolling?: boolean; startDate?: string; endDate?: string } & Disableable) | null;
  bookerLayouts?: { defaultLayout: string; enabledLayouts: string[] };
  confirmationPolicy: ({ type?: string; noticeThreshold?: { count: number; unit: string }; blockUnconfirmedBookingsInBooker?: boolean } & Disableable) | null;
  recurrence: ({ interval?: number; occurrences?: number; frequency?: string } & Disableable) | null;
  color?: { lightThemeHex: string; darkThemeHex: string };
  emailSettings?: { disableEmailsToAttendees?: boolean; disableEmailsToHosts?: boolean };
  metadata: Record<string, unknown>;
  hosts: EventTypeHost[];
  bookingUrl: string | null;
}

export interface BookingAttendee {
  name: string;
  email: string;
  timeZone: string;
  language: string;
  phoneNumber?: string;
  absent: boolean;
  seatUid?: string;
}

export interface Booking {
  id: number;
  uid: string;
  title: string;
  description: string;
  hosts: Array<{ id: number; name: string; email: string; username: string; timeZone: string }>;
  status: "accepted" | "pending" | "cancelled" | "rejected";
  cancellationReason?: string;
  cancelledByEmail?: string;
  reschedulingReason?: string;
  rescheduledByEmail?: string;
  rescheduledFromUid?: string;
  rescheduledToUid?: string;
  recurringEventUid?: string;
  start: string;
  end: string;
  duration: number;
  eventTypeId: number | null;
  eventType: { id: number; slug: string; title: string } | null;
  meetingUrl?: string;
  location: string;
  absentHost: boolean;
  createdAt: string;
  updatedAt: string;
  attendees: BookingAttendee[];
  guests: string[];
  bookingFieldsResponses: Record<string, unknown>;
}

/** A team invitation waiting on the signed-in user. */
export interface Invitation {
  /** `membership` invites are answered by id; `token` invites by their token. */
  kind: "membership" | "token";
  id: number;
  token?: string;
  teamId: number;
  teamName: string;
  teamSlug: string | null;
  isOrganization: boolean;
  role: string;
  invitedBy: string | null;
}

export interface Team {
  id: number;
  parentId: number | null;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  hideBranding: boolean;
  isOrganization: boolean;
  isPrivate: boolean;
  hideBookATeamMember: boolean;
  metadata: Record<string, unknown>;
  theme: string | null;
  brandColor: string | null;
  darkBrandColor: string | null;
  timeFormat: number;
  timeZone: string;
  weekStart: string;
}

export interface Membership {
  id: number;
  userId: number;
  teamId: number;
  role: "OWNER" | "ADMIN" | "MEMBER";
  accepted: boolean;
  disableImpersonation: boolean;
  user?: { id: number; name: string; email: string; username: string; avatarUrl: string | null };
}

export interface OooEntry {
  id: number;
  uuid: string;
  userId: number;
  start: string;
  end: string;
  reason: string;
  notes: string | null;
  toUserId: number | null;
}

export interface AuthProviders {
  oidc: { enabled: boolean; label: string; authorizeUrl: string };
  google: { enabled: boolean; label: string; authorizeUrl: string };
  guest: { enabled: boolean };
  /** Calendar linking is configured separately from Google sign-in. */
  googleCalendar: { enabled: boolean };
}

export interface CalendarConnection {
  id: number;
  provider: string;
  email: string;
  calendarId: string;
  calendarName: string | null;
  syncBookings: boolean;
  checkConflicts: boolean;
  needsReconnect: boolean;
  lastError: string | null;
  connectedAt: string;
}

export interface GoogleCalendarOption {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

export interface SlotMap {
  [date: string]: Array<{ start: string; seatsRemaining?: number; seatsTotal?: number }>;
}

export interface PublicProfile {
  profile: {
    id: number;
    username: string;
    name: string;
    bio: string | null;
    avatarUrl: string | null;
    timeZone: string;
    weekStart: string;
    timeFormat: number;
  };
  eventTypes: EventType[];
}

export interface PublicTeamProfile {
  profile: Team;
  members: Array<{
    id: number;
    name: string;
    username: string;
    avatarUrl: string | null;
    bio: string | null;
    eventTypes: EventType[];
  }>;
  eventTypes: EventType[];
}
