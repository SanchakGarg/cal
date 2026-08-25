// Outbound webhooks. Fire-and-forget so a slow subscriber never blocks a booking.

import { createHmac } from "node:crypto";
import { query } from "../db/pool.ts";
import { env } from "../env.ts";
import { badRequest } from "../http/errors.ts";

/** Hostnames that resolve inside the deployment, including cloud metadata. */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
];

/** Webhook targets are user-supplied and fetched by the server, which is a
 *  server-side request forgery primitive unless the destination is constrained. */
export function assertSafeWebhookUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest("subscriberUrl must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest("subscriberUrl must use http or https");
  }
  if (env.allowPrivateWebhookTargets) return parsed;

  const host = parsed.hostname;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw badRequest("subscriberUrl must not point at a private or loopback address");
  }
  return parsed;
}

export type WebhookTrigger =
  | "BOOKING_CREATED"
  | "BOOKING_RESCHEDULED"
  | "BOOKING_CANCELLED"
  | "BOOKING_REQUESTED"
  | "BOOKING_REJECTED"
  | "BOOKING_CONFIRMED"
  | "MEETING_ENDED";

interface Subscriber {
  subscriber_url: string;
  secret: string | null;
  payload_template: string | null;
}

export interface WebhookScope {
  userId?: number | null;
  teamId?: number | null;
  eventTypeId?: number | null;
}

export async function dispatchWebhooks(
  trigger: WebhookTrigger,
  scope: WebhookScope,
  payload: unknown
): Promise<void> {
  const subscribers = await query<Subscriber>(
    `SELECT subscriber_url, secret, payload_template
     FROM webhooks
     WHERE active = TRUE
       AND $1 = ANY(triggers)
       AND (
         (event_type_id IS NOT NULL AND event_type_id = $2)
         OR (team_id IS NOT NULL AND team_id = $3)
         OR (user_id IS NOT NULL AND user_id = $4)
       )`,
    [trigger, scope.eventTypeId ?? null, scope.teamId ?? null, scope.userId ?? null]
  );
  if (subscribers.length === 0) return;

  const body = JSON.stringify({
    triggerEvent: trigger,
    createdAt: new Date().toISOString(),
    payload,
  });

  await Promise.all(
    subscribers.map(async (subscriber) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (subscriber.secret) {
        headers["x-cal-signature-256"] = createHmac("sha256", subscriber.secret)
          .update(body)
          .digest("hex");
      }
      try {
        // Re-check here too: rows may predate the validation on the write path.
        assertSafeWebhookUrl(subscriber.subscriber_url);
        await fetch(subscriber.subscriber_url, {
          method: "POST",
          headers,
          body: subscriber.payload_template ?? body,
          // Following a redirect would let a public URL bounce us somewhere private.
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        console.warn(`webhook ${trigger} -> ${subscriber.subscriber_url} failed:`, error);
      }
    })
  );
}
