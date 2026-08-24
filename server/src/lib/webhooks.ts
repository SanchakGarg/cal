// Outbound webhooks. Fire-and-forget so a slow subscriber never blocks a booking.

import { createHmac } from "node:crypto";
import { query } from "../db/pool.ts";

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
        await fetch(subscriber.subscriber_url, {
          method: "POST",
          headers,
          body: subscriber.payload_template ?? body,
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        console.warn(`webhook ${trigger} -> ${subscriber.subscriber_url} failed:`, error);
      }
    })
  );
}
