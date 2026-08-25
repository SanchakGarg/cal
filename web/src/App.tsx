import { useEffect, useState } from "react";
import { Shell } from "./app/Shell.tsx";
import { useAuth } from "./app/auth.tsx";
import { Link, matchPath, useRouter } from "./app/router.tsx";
import { Skeleton } from "./ui/Layout.tsx";
import { api } from "./lib/api.ts";
import { AuthCallbackPage } from "./pages/AuthCallbackPage.tsx";
import { AvailabilityDetailPage } from "./pages/AvailabilityDetailPage.tsx";
import { AvailabilityPage } from "./pages/AvailabilityPage.tsx";
import { BookerPage } from "./pages/BookerPage.tsx";
import { BookingDetailPage } from "./pages/BookingDetailPage.tsx";
import { BookingCancelPage } from "./pages/BookingCancelPage.tsx";
import { BookingsPage, type BookingStatus } from "./pages/BookingsPage.tsx";
import { EventTypeCreatePage } from "./pages/EventTypeCreatePage.tsx";
import { OutOfOfficeCreatePage } from "./pages/OutOfOfficeCreatePage.tsx";
import { ScheduleCreatePage } from "./pages/ScheduleCreatePage.tsx";
import { TeamCreatePage } from "./pages/TeamCreatePage.tsx";
import { EventTypeDetailPage } from "./pages/EventTypeDetailPage.tsx";
import { EventTypesPage } from "./pages/EventTypesPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { OnboardingPage } from "./pages/OnboardingPage.tsx";
import { OrganizationPage } from "./pages/OrganizationPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { SettingsPage } from "./pages/SettingsPages.tsx";
import { TeamPage, type TeamTab } from "./pages/TeamPage.tsx";
import { TeamsPage } from "./pages/TeamsPage.tsx";
import { TroubleshootPage } from "./pages/TroubleshootPage.tsx";

const BOOKING_STATUSES: BookingStatus[] = ["upcoming", "unconfirmed", "recurring", "past", "cancelled"];

// Paths that never require a session.
const PUBLIC_PREFIXES = ["/auth/", "/booking/", "/reschedule/", "/d/", "/team/"];

export function App() {
  const { path, search, navigate } = useRouter();
  const { me, loading } = useAuth();

  const isAppRoute =
    ["/event-types", "/bookings", "/availability", "/teams", "/settings", "/getting-started"].some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    );

  useEffect(() => {
    if (loading) return;
    if (!me && isAppRoute) navigate("/auth/login", { replace: true });
    if (me && path === "/auth/login") {
      navigate(me.completedOnboarding ? "/event-types" : "/getting-started", { replace: true });
    }
    // Onboarding is a suggestion, not a cage: users land there on first login but
    // can navigate anywhere in the app afterwards.
  }, [loading, me, path, isAppRoute, navigate]);

  if (path === "/") return <RootRedirect />;

  if (path === "/auth/login") return <LoginPage />;
  if (path === "/auth/callback") return <AuthCallbackPage />;
  if (path === "/getting-started") return <OnboardingPage />;

  // Private-link booker: /d/:linkId resolves to an event type, then books it.
  const privateLink = matchPath("/d/:linkId", path);
  if (privateLink) return <PrivateLinkBooker linkId={privateLink.params.linkId} />;

  const bookingDetail = matchPath("/booking/:uid", path);
  if (bookingDetail) return <BookingDetailPage uid={bookingDetail.params.uid} />;

  const reschedule = matchPath("/reschedule/:uid", path);
  if (reschedule) return <RescheduleBooker uid={reschedule.params.uid} />;

  if (loading) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton height={220} />
      </div>
    );
  }

  if (me) {
    if (path === "/event-types") {
      return (
        <Shell>
          <EventTypesPage />
        </Shell>
      );
    }
    // `/new` has to be matched before `/:id`, otherwise it is read as an id.
    if (path === "/event-types/new") {
      return (
        <Shell>
          <EventTypeCreatePage />
        </Shell>
      );
    }
    const eventTypeDetail = matchPath("/event-types/:id", path);
    if (eventTypeDetail) {
      return (
        <Shell>
          <EventTypeDetailPage eventTypeId={Number(eventTypeDetail.params.id)} />
        </Shell>
      );
    }
    if (path === "/availability") {
      return (
        <Shell>
          <AvailabilityPage />
        </Shell>
      );
    }
    if (path === "/availability/troubleshoot") {
      return (
        <Shell>
          <TroubleshootPage />
        </Shell>
      );
    }
    if (path === "/availability/new") {
      return (
        <Shell>
          <ScheduleCreatePage />
        </Shell>
      );
    }
    const availabilityDetail = matchPath("/availability/:id", path);
    if (availabilityDetail) {
      return (
        <Shell>
          <AvailabilityDetailPage scheduleId={Number(availabilityDetail.params.id)} />
        </Shell>
      );
    }
    const bookingCancel = matchPath("/bookings/:uid/cancel", path);
    if (bookingCancel) {
      return (
        <Shell>
          <BookingCancelPage uid={bookingCancel.params.uid} />
        </Shell>
      );
    }
    const bookings = matchPath("/bookings/:status", path);
    if (bookings) {
      const status = BOOKING_STATUSES.includes(bookings.params.status as BookingStatus)
        ? (bookings.params.status as BookingStatus)
        : "upcoming";
      return (
        <Shell>
          <BookingsPage status={status} />
        </Shell>
      );
    }
    if (path === "/bookings") {
      return (
        <Shell>
          <BookingsPage status="upcoming" />
        </Shell>
      );
    }
    if (path === "/teams") {
      return (
        <Shell>
          <TeamsPage />
        </Shell>
      );
    }
    if (path === "/teams/new") {
      return (
        <Shell>
          <TeamCreatePage
            kind={search.get("type") === "organization" ? "organization" : "team"}
          />
        </Shell>
      );
    }
    // Team event types are edited inside the team, not in the personal list.
    const teamEventTypeNew = matchPath("/teams/:id/event-types/new", path);
    if (teamEventTypeNew) {
      return (
        <Shell>
          <EventTypeCreatePage teamId={Number(teamEventTypeNew.params.id)} />
        </Shell>
      );
    }
    const teamEventType = matchPath("/teams/:id/event-types/:eventTypeId", path);
    if (teamEventType) {
      return (
        <Shell>
          <EventTypeDetailPage
            eventTypeId={Number(teamEventType.params.eventTypeId)}
            teamId={Number(teamEventType.params.id)}
          />
        </Shell>
      );
    }
    const teamSection = matchPath("/teams/:id/:tab", path);
    if (teamSection) {
      const tab = (["dashboard", "event-types", "members", "availability"] as TeamTab[]).includes(
        teamSection.params.tab as TeamTab
      )
        ? (teamSection.params.tab as TeamTab)
        : "dashboard";
      return (
        <Shell>
          <TeamPage teamId={Number(teamSection.params.id)} tab={tab} />
        </Shell>
      );
    }
    const teamRoot = matchPath("/teams/:id", path);
    if (teamRoot) {
      return (
        <Shell>
          <TeamPage teamId={Number(teamRoot.params.id)} tab="dashboard" />
        </Shell>
      );
    }
    const orgTab = matchPath("/settings/organization/:tab", path);
    if (orgTab) {
      const tab = orgTab.params.tab as "members" | "teams" | "availability";
      return (
        <Shell>
          <OrganizationPage tab={tab} />
        </Shell>
      );
    }
    if (path === "/settings/out-of-office/new") {
      return (
        <Shell>
          <OutOfOfficeCreatePage />
        </Shell>
      );
    }
    const settings = matchPath("/settings/:tab", path);
    if (settings) {
      const tab = settings.params.tab as "profile" | "general" | "out-of-office";
      return (
        <Shell>
          <SettingsPage tab={tab} />
        </Shell>
      );
    }
  }

  // Public routes come last so /:username does not shadow app pages.
  const teamEvent = matchPath("/team/:slug/:eventSlug", path);
  if (teamEvent) {
    return <BookerPage teamSlug={teamEvent.params.slug} eventSlug={teamEvent.params.eventSlug} />;
  }
  const teamProfile = matchPath("/team/:slug", path);
  if (teamProfile) return <ProfilePage teamSlug={teamProfile.params.slug} />;

  const userEvent = matchPath("/:username/:eventSlug", path);
  if (userEvent) {
    return <BookerPage username={userEvent.params.username} eventSlug={userEvent.params.eventSlug} />;
  }
  const userProfile = matchPath("/:username", path);
  if (userProfile && !PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return <ProfilePage username={userProfile.params.username} />;
  }

  return <NotFound path={path} />;
}

function NotFound({ path }: { path: string }) {
  const { me } = useAuth();
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", display: "grid", gap: 12, justifyItems: "center" }}>
        <h1>Page not found</h1>
        <p className="cal-muted">{path}</p>
        <Link to={me ? "/event-types" : "/auth/login"} className="cal-btn cal-btn--secondary cal-btn--md">
          <span className="cal-btn__label">{me ? "Back to event types" : "Go to sign in"}</span>
        </Link>
      </div>
    </div>
  );
}

function RootRedirect() {
  const { me, loading } = useAuth();
  const { navigate } = useRouter();
  useEffect(() => {
    if (loading) return;
    navigate(me ? "/event-types" : "/auth/login", { replace: true });
  }, [me, loading, navigate]);
  return null;
}

function PrivateLinkBooker({ linkId }: { linkId: string }) {
  const { navigate } = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    void api
      .get<{ bookingUrl: string | null }>(`/v2/public/private-links/${linkId}`, undefined, { auth: false })
      .then((eventType) => {
        if (!eventType.bookingUrl) {
          setError(true);
          return;
        }
        const target = new URL(eventType.bookingUrl, window.location.origin);
        navigate(`${target.pathname}${target.search}`, { replace: true });
      })
      .catch(() => setError(true));
  }, [linkId, navigate]);

  if (!error) return null;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <h1>This link is no longer valid</h1>
        <p className="cal-muted">It may have expired or reached its usage limit.</p>
      </div>
    </div>
  );
}

function RescheduleBooker({ uid }: { uid: string }) {
  const { navigate } = useRouter();
  const [target, setTarget] = useState<{ username: string; eventSlug: string } | null>(null);

  useEffect(() => {
    void api
      .get<{ eventType: { slug: string } | null; hosts: Array<{ username: string }> }>(
        `/v2/bookings/${uid}`,
        undefined,
        { auth: false }
      )
      .then((booking) => {
        if (!booking.eventType || !booking.hosts[0]) {
          navigate("/", { replace: true });
          return;
        }
        setTarget({ username: booking.hosts[0].username, eventSlug: booking.eventType.slug });
      })
      .catch(() => navigate("/", { replace: true }));
  }, [uid, navigate]);

  if (!target) return null;
  return <BookerPage username={target.username} eventSlug={target.eventSlug} rescheduleUid={uid} />;
}
