// Public profile: the list of an individual's or a team's bookable events.
// On a team page the visitor can also book a single member directly.
import { useEffect, useState } from "react";
import { Avatar, AvatarGroup, Badge, Skeleton } from "../ui/Layout.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { api } from "../lib/api.ts";
import type { EventType, PublicProfile, PublicTeamProfile } from "../lib/types.ts";
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

  const team = "members" in data ? (data as PublicTeamProfile) : null;
  const user = team ? null : (data as PublicProfile);
  const name = team ? team.profile.name : user!.profile.name;
  const bio = data.profile.bio;
  const avatar = team ? team.profile.logoUrl : user!.profile.avatarUrl;
  const handle = team ? `/team/${team.profile.slug}` : `/${user!.profile.username}`;
  const bookableMembers = (team?.members ?? []).filter((member) => member.eventTypes.length > 0);

  return (
    <div className="cal-profile">
      <div className="cal-profile__head">
        {team && team.members.length > 0 ? (
          <AvatarGroup
            people={team.members.map((member) => ({
              name: member.name,
              avatarUrl: member.avatarUrl,
              colorKey: member.username,
            }))}
            size={40}
          />
        ) : (
          <Avatar name={name} src={avatar} size={64} colorKey={handle} />
        )}
        <h1>{name}</h1>
        {bio ? <p className="cal-muted">{bio}</p> : null}
        {team ? <ProfileContact team={team.profile} /> : null}
      </div>

      <div className="cal-profile__events">
        {team && data.eventTypes.length > 0 ? (
          <p className="cal-profile__section">Book the team</p>
        ) : null}
        {data.eventTypes.length === 0 && !team ? (
          <p className="cal-muted">No public event types yet.</p>
        ) : null}
        {data.eventTypes.map((eventType) => (
          <EventCard key={eventType.id} eventType={eventType} href={`${handle}/${eventType.slug}`} />
        ))}

        {team && data.eventTypes.length === 0 && bookableMembers.length === 0 ? (
          <p className="cal-muted">No public event types yet.</p>
        ) : null}

        {team && bookableMembers.length > 0 ? (
          <>
            <p className="cal-profile__section">Book a team member</p>
            <p className="cal-hint cal-profile__section-hint">
              Pick someone to meet one to one. Times come from their own availability.
            </p>
            {bookableMembers.map((member) => (
              <MemberCard key={member.id} member={member} />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A team's contact details, only the ones it filled in. Rendered as links where
 * a link is what the reader wants: tapping a phone number should dial it.
 */
function ProfileContact({ team }: { team: PublicTeamProfile["profile"] }) {
  const items: Array<{ icon: IconName; label: string; href?: string }> = [];
  if (team.location) items.push({ icon: "mapPin", label: team.location });
  if (team.websiteUrl) {
    items.push({
      icon: "link",
      // The scheme is noise on screen but required in the href.
      label: team.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      href: /^https?:\/\//.test(team.websiteUrl) ? team.websiteUrl : `https://${team.websiteUrl}`,
    });
  }
  if (team.contactEmail) {
    items.push({ icon: "mail", label: team.contactEmail, href: `mailto:${team.contactEmail}` });
  }
  if (team.contactPhone) {
    items.push({
      icon: "phone",
      label: team.contactPhone,
      href: `tel:${team.contactPhone.replace(/[^+\d]/g, "")}`,
    });
  }
  if (items.length === 0) return null;

  return (
    <ul className="cal-profile__contact">
      {items.map((item) => (
        <li key={item.label}>
          <Icon name={item.icon} size={14} />
          {item.href ? (
            <a href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              {item.label}
            </a>
          ) : (
            <span>{item.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function EventCard({ eventType, href }: { eventType: EventType; href: string }) {
  return (
    <Link to={href} className="cal-profile__event cal-card">
      <div>
        <strong>{eventType.title}</strong>
        {eventType.description ? <p className="cal-hint">{eventType.description}</p> : null}
        <div className="cal-row cal-profile__event-meta">
          <Badge startIcon="clock">{durationLabel(eventType.lengthInMinutes)}</Badge>
          {eventType.seats && !eventType.seats.disabled ? (
            <Badge startIcon="users">{eventType.seats.seatsPerTimeSlot} seats</Badge>
          ) : null}
        </div>
      </div>
      <Icon name="chevronRight" size={16} />
    </Link>
  );
}

function MemberCard({ member }: { member: PublicTeamProfile["members"][number] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="cal-card cal-profile__member">
      <button
        type="button"
        className="cal-profile__member-head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar name={member.name} src={member.avatarUrl} size={36} colorKey={member.username} />
        <span className="cal-profile__member-name">
          <strong>{member.name}</strong>
          <span className="cal-hint">
            {member.bio ?? `@${member.username} · ${member.eventTypes.length} event${member.eventTypes.length === 1 ? "" : "s"}`}
          </span>
        </span>
        <span className={`cal-profile__member-chevron${open ? " cal-profile__member-chevron--open" : ""}`}>
          <Icon name="chevronDown" size={16} />
        </span>
      </button>

      {open ? (
        <div className="cal-profile__member-events">
          {member.eventTypes.map((eventType) => (
            <EventCard
              key={eventType.id}
              eventType={eventType}
              href={`/${member.username}/${eventType.slug}`}
            />
          ))}
          <Link to={`/${member.username}`} className="cal-profile__member-all">
            View full profile
          </Link>
        </div>
      ) : null}
    </div>
  );
}
