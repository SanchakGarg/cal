// Public profile: the list of an individual's or a team's bookable events.
import { useEffect, useState } from "react";
import { Avatar, AvatarGroup, Badge, Skeleton } from "../ui/Layout.tsx";
import { Icon } from "../ui/Icon.tsx";
import { api } from "../lib/api.ts";
import type { PublicProfile, PublicTeamProfile } from "../lib/types.ts";
import { durationLabel } from "../lib/time.ts";
import { Link } from "../app/router.tsx";
import "./ProfilePage.css";

export function ProfilePage({ username, teamSlug }: { username?: string; teamSlug?: string }) {
  const [data, setData] = useState<PublicProfile | PublicTeamProfile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const path = teamSlug ? `/v2/public/teams/${teamSlug}` : `/v2/public/users/${username}`;
    void api
      .get<PublicProfile | PublicTeamProfile>(path, undefined, { auth: false })
      .then(setData)
      .catch(() => setMissing(true));
  }, [username, teamSlug]);

  if (missing) {
    return (
      <div className="cal-profile">
        <h1>Nothing here</h1>
        <p className="cal-muted">This page does not exist.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="cal-profile">
        <Skeleton height={220} width={520} />
      </div>
    );
  }

  const isTeam = "members" in data;
  const name = isTeam ? data.profile.name : (data as PublicProfile).profile.name;
  const bio = data.profile.bio;
  const avatar = isTeam ? (data as PublicTeamProfile).profile.logoUrl : (data as PublicProfile).profile.avatarUrl;
  const handle = isTeam ? `/team/${(data as PublicTeamProfile).profile.slug}` : `/${(data as PublicProfile).profile.username}`;

  return (
    <div className="cal-profile">
      <div className="cal-profile__head">
        {isTeam && (data as PublicTeamProfile).members.length > 0 ? (
          <AvatarGroup
            people={(data as PublicTeamProfile).members.map((member) => ({
              name: member.name,
              avatarUrl: member.avatarUrl,
            }))}
            size={40}
          />
        ) : (
          <Avatar name={name} src={avatar} size={64} />
        )}
        <h1>{name}</h1>
        {bio ? <p className="cal-muted">{bio}</p> : null}
      </div>

      <div className="cal-profile__events">
        {data.eventTypes.length === 0 ? <p className="cal-muted">No public event types yet.</p> : null}
        {data.eventTypes.map((eventType) => (
          <Link key={eventType.id} to={`${handle}/${eventType.slug}`} className="cal-profile__event cal-card">
            <div>
              <strong>{eventType.title}</strong>
              {eventType.description ? <p className="cal-hint">{eventType.description}</p> : null}
              <div className="cal-row cal-profile__event-meta">
                <Badge startIcon="clock">{durationLabel(eventType.lengthInMinutes)}</Badge>
                {eventType.schedulingType ? (
                  <Badge tone="info">
                    {eventType.schedulingType === "roundRobin" ? "Round robin" : eventType.schedulingType}
                  </Badge>
                ) : null}
                {eventType.seats && !eventType.seats.disabled ? (
                  <Badge startIcon="users">{eventType.seats.seatsPerTimeSlot} seats</Badge>
                ) : null}
              </div>
            </div>
            <Icon name="chevronRight" size={16} />
          </Link>
        ))}
      </div>
    </div>
  );
}
