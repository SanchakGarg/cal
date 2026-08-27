// Team invitation mail.
import { queryOne } from "../../db/pool.ts";
import { teamInviteMail } from "../../lib/email-templates.ts";
import { sendMailInBackground } from "../../lib/mail.ts";

export interface InviteOutcome {
  email: string;
  status: string;
  token?: string;
}

/**
 * Tells each invitee they were added. Invitees who already have an account get a
 * link to their teams; the rest get their invite token, which is the only way
 * back into the flow.
 */
export async function notifyTeamInvites(
  teamId: number,
  inviter: { name: string; email: string },
  outcomes: InviteOutcome[]
): Promise<void> {
  if (outcomes.length === 0) return;
  const team = await queryOne<{ name: string }>("SELECT name FROM teams WHERE id = $1", [teamId]);
  if (!team) return;

  for (const outcome of outcomes) {
    sendMailInBackground({
      to: outcome.email,
      ...teamInviteMail({
        teamName: team.name,
        inviterName: inviter.name || inviter.email,
        inviteeEmail: outcome.email,
        token: outcome.token,
        existingUser: outcome.status === "added",
      }),
      // Replies should reach the person who did the inviting, not the void.
      replyTo: inviter.email,
    });
  }
}
