import { randomBytes } from "node:crypto";
import { query, queryOne, withTransaction } from "../../db/pool.ts";
import { badRequest, conflict, notFound } from "../../http/errors.ts";
import { slugify } from "../../http/validate.ts";
import {
  type MembershipRow,
  type TeamRow,
  serializeMembership,
  serializeTeam,
} from "../serialize.ts";
import { DEFAULT_TIME_ZONE } from "../../lib/tz.ts";

export const TEAM_COLUMNS = `
  id, parent_id, name, slug, logo_url, banner_url, bio, hide_branding, is_organization,
  is_private, hide_book_a_team_member, metadata, theme, brand_color, dark_brand_color,
  time_format, time_zone, week_start`;

const MEMBERSHIP_COLUMNS = `
  m.id, m.user_id, m.team_id, m.role, m.accepted, m.disable_impersonation,
  u.name AS user_name, u.email AS user_email, u.username AS user_username,
  u.avatar_url AS user_avatar_url`;

export interface TeamInput {
  name: string;
  slug?: string;
  bio?: string;
  logoUrl?: string;
  bannerUrl?: string;
  isPrivate?: boolean;
  hideBranding?: boolean;
  hideBookATeamMember?: boolean;
  theme?: string;
  brandColor?: string;
  darkBrandColor?: string;
  timeZone?: string;
  weekStart?: string;
  timeFormat?: number;
  metadata?: Record<string, unknown>;
}

export async function createTeam(
  input: TeamInput & { parentId?: number | null; isOrganization?: boolean },
  creator: { userId: number; autoAcceptCreator?: boolean; addCreatorAsOwner?: boolean }
) {
  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  return withTransaction(async (tx) => {
    const clash = await tx.queryOne(
      input.parentId
        ? "SELECT 1 FROM teams WHERE slug = $1 AND parent_id = $2"
        : "SELECT 1 FROM teams WHERE slug = $1 AND parent_id IS NULL",
      input.parentId ? [slug, input.parentId] : [slug]
    );
    if (clash) throw conflict(`A team with slug "${slug}" already exists`);

    const team = await tx.queryOne<TeamRow>(
      `INSERT INTO teams (name, slug, parent_id, is_organization, bio, logo_url, banner_url,
                          is_private, hide_branding, hide_book_a_team_member, theme, brand_color,
                          dark_brand_color, time_zone, week_start, time_format, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               COALESCE($14, $18::text), COALESCE($15, 'Monday'), COALESCE($16, 12), $17::jsonb)
       RETURNING ${TEAM_COLUMNS}`,
      [
        input.name,
        slug,
        input.parentId ?? null,
        input.isOrganization ?? false,
        input.bio ?? null,
        input.logoUrl ?? null,
        input.bannerUrl ?? null,
        input.isPrivate ?? false,
        input.hideBranding ?? false,
        input.hideBookATeamMember ?? false,
        input.theme ?? null,
        input.brandColor ?? null,
        input.darkBrandColor ?? null,
        input.timeZone ?? null,
        input.weekStart ?? null,
        input.timeFormat ?? null,
        JSON.stringify(input.metadata ?? {}),
        DEFAULT_TIME_ZONE,
      ]
    );

    if (creator.addCreatorAsOwner !== false) {
      await tx.query(
        `INSERT INTO memberships (user_id, team_id, role, accepted) VALUES ($1, $2, 'OWNER', $3)`,
        [creator.userId, team!.id, creator.autoAcceptCreator ?? true]
      );
    }
    if (input.isOrganization) {
      await tx.query("UPDATE users SET organization_id = $1 WHERE id = $2 AND organization_id IS NULL", [
        team!.id,
        creator.userId,
      ]);
    }
    return serializeTeam(team!);
  });
}

export async function updateTeam(teamId: number, input: Partial<TeamInput>) {
  const team = await queryOne<TeamRow>(
    `UPDATE teams SET
       name = COALESCE($2, name),
       slug = COALESCE($3, slug),
       bio = COALESCE($4, bio),
       logo_url = COALESCE($5, logo_url),
       banner_url = COALESCE($6, banner_url),
       is_private = COALESCE($7, is_private),
       hide_branding = COALESCE($8, hide_branding),
       hide_book_a_team_member = COALESCE($9, hide_book_a_team_member),
       theme = COALESCE($10, theme),
       brand_color = COALESCE($11, brand_color),
       dark_brand_color = COALESCE($12, dark_brand_color),
       time_zone = COALESCE($13, time_zone),
       week_start = COALESCE($14, week_start),
       time_format = COALESCE($15, time_format),
       updated_at = now()
     WHERE id = $1
     RETURNING ${TEAM_COLUMNS}`,
    [
      teamId,
      input.name ?? null,
      input.slug ? slugify(input.slug) : null,
      input.bio ?? null,
      input.logoUrl ?? null,
      input.bannerUrl ?? null,
      input.isPrivate ?? null,
      input.hideBranding ?? null,
      input.hideBookATeamMember ?? null,
      input.theme ?? null,
      input.brandColor ?? null,
      input.darkBrandColor ?? null,
      input.timeZone ?? null,
      input.weekStart ?? null,
      input.timeFormat ?? null,
    ]
  );
  if (!team) throw notFound("Team not found");
  return serializeTeam(team);
}

export async function getTeam(teamId: number) {
  const team = await queryOne<TeamRow>(`SELECT ${TEAM_COLUMNS} FROM teams WHERE id = $1`, [teamId]);
  if (!team) throw notFound("Team not found");
  return serializeTeam(team);
}

export async function deleteTeam(teamId: number): Promise<void> {
  await query("DELETE FROM teams WHERE id = $1", [teamId]);
}

export async function listTeamsForUser(userId: number, opts: { organizations?: boolean } = {}) {
  const rows = await query<TeamRow>(
    `SELECT ${TEAM_COLUMNS.replace(/\s+/g, " ")
      .split(", ")
      .map((column) => `t.${column.trim()}`)
      .join(", ")}
     FROM teams t
     JOIN memberships m ON m.team_id = t.id
     WHERE m.user_id = $1 AND m.accepted = TRUE
       AND t.is_organization = $2
     ORDER BY t.id`,
    [userId, opts.organizations ?? false]
  );
  return rows.map(serializeTeam);
}

export async function listChildTeams(orgId: number) {
  const rows = await query<TeamRow>(
    `SELECT ${TEAM_COLUMNS} FROM teams WHERE parent_id = $1 ORDER BY id`,
    [orgId]
  );
  return rows.map(serializeTeam);
}

export async function listMemberships(teamId: number) {
  const rows = await query<MembershipRow>(
    `SELECT ${MEMBERSHIP_COLUMNS}
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1 ORDER BY m.id`,
    [teamId]
  );
  return rows.map(serializeMembership);
}

export async function getMembership(teamId: number, membershipId: number) {
  const row = await queryOne<MembershipRow>(
    `SELECT ${MEMBERSHIP_COLUMNS}
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1 AND m.id = $2`,
    [teamId, membershipId]
  );
  if (!row) throw notFound("Membership not found");
  return serializeMembership(row);
}

export async function addMembership(
  teamId: number,
  input: { userId: number; role?: string; accepted?: boolean }
) {
  const user = await queryOne("SELECT 1 FROM users WHERE id = $1", [input.userId]);
  if (!user) throw badRequest("User not found");
  const existing = await queryOne("SELECT 1 FROM memberships WHERE user_id = $1 AND team_id = $2", [
    input.userId,
    teamId,
  ]);
  if (existing) throw conflict("That user is already a member of this team");

  const row = await queryOne<{ id: number }>(
    `INSERT INTO memberships (user_id, team_id, role, accepted)
     VALUES ($1, $2, COALESCE($3, 'MEMBER'), COALESCE($4, FALSE)) RETURNING id`,
    [input.userId, teamId, input.role ?? null, input.accepted ?? null]
  );

  // Organization membership also stamps the user's organization.
  const team = await queryOne<{ is_organization: boolean }>(
    "SELECT is_organization FROM teams WHERE id = $1",
    [teamId]
  );
  if (team?.is_organization) {
    await query("UPDATE users SET organization_id = $1 WHERE id = $2", [teamId, input.userId]);
  }
  return getMembership(teamId, row!.id);
}

export async function updateMembership(
  teamId: number,
  membershipId: number,
  input: { role?: string; accepted?: boolean; disableImpersonation?: boolean }
) {
  const row = await queryOne<{ id: number }>(
    `UPDATE memberships SET
       role = COALESCE($3, role),
       accepted = COALESCE($4, accepted),
       disable_impersonation = COALESCE($5, disable_impersonation)
     WHERE team_id = $1 AND id = $2 RETURNING id`,
    [teamId, membershipId, input.role ?? null, input.accepted ?? null, input.disableImpersonation ?? null]
  );
  if (!row) throw notFound("Membership not found");
  return getMembership(teamId, row.id);
}

export async function removeMembership(teamId: number, membershipId: number): Promise<void> {
  const row = await queryOne<{ id: number; user_id: number }>(
    "DELETE FROM memberships WHERE team_id = $1 AND id = $2 RETURNING id, user_id",
    [teamId, membershipId]
  );
  if (!row) throw notFound("Membership not found");
  await query(
    `DELETE FROM event_type_hosts
     WHERE user_id = $1 AND event_type_id IN (SELECT id FROM event_types WHERE team_id = $2)`,
    [row.user_id, teamId]
  );
}

export interface InviteResult {
  email: string;
  status: "invited" | "added";
  token?: string;
  membershipId?: number;
}

/** Existing users are added straight away; unknown emails get an invite token. */
export async function inviteToTeam(
  teamId: number,
  invites: Array<{ email: string; role?: string }>
): Promise<InviteResult[]> {
  const results: InviteResult[] = [];
  for (const invite of invites) {
    const user = await queryOne<{ id: number }>("SELECT id FROM users WHERE lower(email) = lower($1)", [
      invite.email,
    ]);
    if (user) {
      const existing = await queryOne<{ id: number }>(
        "SELECT id FROM memberships WHERE user_id = $1 AND team_id = $2",
        [user.id, teamId]
      );
      if (existing) {
        results.push({ email: invite.email, status: "added", membershipId: existing.id });
        continue;
      }
      const membership = await addMembership(teamId, {
        userId: user.id,
        role: invite.role,
        accepted: false,
      });
      results.push({ email: invite.email, status: "added", membershipId: membership.id });
      continue;
    }
    const token = randomBytes(24).toString("base64url");
    await query(
      `INSERT INTO team_invites (team_id, email, role, token, expires_at)
       VALUES ($1, $2, COALESCE($3, 'MEMBER'), $4, now() + interval '14 days')`,
      [teamId, invite.email, invite.role ?? null, token]
    );
    results.push({ email: invite.email, status: "invited", token });
  }
  return results;
}

export async function acceptInvite(token: string, userId: number) {
  const invite = await queryOne<{ id: number; team_id: number; role: string }>(
    `SELECT id, team_id, role FROM team_invites
     WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [token]
  );
  if (!invite) throw notFound("Invite not found or expired");
  await query("UPDATE team_invites SET accepted_at = now() WHERE id = $1", [invite.id]);
  const existing = await queryOne<{ id: number }>(
    "SELECT id FROM memberships WHERE user_id = $1 AND team_id = $2",
    [userId, invite.team_id]
  );
  if (existing) {
    return updateMembership(invite.team_id, existing.id, { accepted: true });
  }
  return addMembership(invite.team_id, { userId, role: invite.role, accepted: true });
}
