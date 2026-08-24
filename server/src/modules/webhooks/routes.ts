import { randomUUID } from "node:crypto";
import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, notFound } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import { asObject, array, oneOf, optBool, optInt, optStr, str } from "../../http/validate.ts";
import { currentUser, requireAuth } from "../../auth/middleware.ts";
import { type WebhookRow, serializeWebhook } from "../serialize.ts";

const TRIGGERS = [
  "BOOKING_CREATED",
  "BOOKING_RESCHEDULED",
  "BOOKING_CANCELLED",
  "BOOKING_REQUESTED",
  "BOOKING_REJECTED",
  "BOOKING_CONFIRMED",
  "MEETING_ENDED",
] as const;

const WEBHOOK_COLUMNS = `
  id, uid, user_id, team_id, event_type_id, subscriber_url, active, triggers, secret,
  payload_template, time, time_unit`;

interface WebhookInput {
  subscriberUrl: string;
  triggers: string[];
  active: boolean;
  secret?: string;
  payloadTemplate?: string;
  time?: number;
  timeUnit?: string;
}

export function parseWebhookInput(raw: unknown, partial = false): Partial<WebhookInput> {
  const body = asObject(raw);
  const triggers = body.triggers === undefined ? undefined : array(body, "triggers");
  if (triggers) {
    for (const [index, trigger] of triggers.entries()) {
      if (!TRIGGERS.includes(String(trigger) as (typeof TRIGGERS)[number])) {
        throw badRequest(`triggers[${index}] must be one of ${TRIGGERS.join(", ")}`);
      }
    }
  }
  if (!partial && !triggers) throw badRequest("triggers is required");
  return {
    subscriberUrl: partial
      ? optStr(body, "subscriberUrl", { max: 500 })
      : str(body, "subscriberUrl", { max: 500 }),
    triggers: triggers?.map(String),
    active: optBool(body, "active") ?? (partial ? undefined : true),
    secret: optStr(body, "secret", { max: 200 }),
    payloadTemplate: optStr(body, "payloadTemplate", { max: 5000 }),
    time: optInt(body, "time", { min: 0 }),
    timeUnit: oneOf(body, "timeUnit", ["DAY", "HOUR", "MINUTE"] as const),
  } as Partial<WebhookInput>;
}

export interface WebhookScopeIds {
  userId?: number | null;
  teamId?: number | null;
  eventTypeId?: number | null;
}

export async function createWebhook(scope: WebhookScopeIds, input: Partial<WebhookInput>) {
  const row = await queryOne<WebhookRow>(
    `INSERT INTO webhooks (uid, user_id, team_id, event_type_id, subscriber_url, active, triggers,
                           secret, payload_template, time, time_unit)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), $7::text[], $8, $9, $10, $11)
     RETURNING ${WEBHOOK_COLUMNS}`,
    [
      randomUUID(),
      scope.userId ?? null,
      scope.teamId ?? null,
      scope.eventTypeId ?? null,
      input.subscriberUrl,
      input.active ?? null,
      input.triggers ?? [],
      input.secret ?? null,
      input.payloadTemplate ?? null,
      input.time ?? null,
      input.timeUnit ?? null,
    ]
  );
  return serializeWebhook(row!);
}

export async function listWebhooks(scope: WebhookScopeIds) {
  const rows = await query<WebhookRow>(
    `SELECT ${WEBHOOK_COLUMNS} FROM webhooks
     WHERE ($1::int IS NULL OR user_id = $1)
       AND ($2::int IS NULL OR team_id = $2)
       AND ($3::int IS NULL OR event_type_id = $3)
     ORDER BY id`,
    [scope.userId ?? null, scope.teamId ?? null, scope.eventTypeId ?? null]
  );
  return rows.map(serializeWebhook);
}

export async function updateWebhook(uid: string, input: Partial<WebhookInput>) {
  const row = await queryOne<WebhookRow>(
    `UPDATE webhooks SET
       subscriber_url = COALESCE($2, subscriber_url),
       active = COALESCE($3, active),
       triggers = COALESCE($4::text[], triggers),
       secret = COALESCE($5, secret),
       payload_template = COALESCE($6, payload_template),
       time = COALESCE($7, time),
       time_unit = COALESCE($8, time_unit)
     WHERE uid = $1
     RETURNING ${WEBHOOK_COLUMNS}`,
    [
      uid,
      input.subscriberUrl ?? null,
      input.active ?? null,
      input.triggers ?? null,
      input.secret ?? null,
      input.payloadTemplate ?? null,
      input.time ?? null,
      input.timeUnit ?? null,
    ]
  );
  if (!row) throw notFound("Webhook not found");
  return serializeWebhook(row);
}

export const webhooksRouter: Router = Router();

webhooksRouter.use(requireAuth);

webhooksRouter.get(
  "/",
  handler(async (req, res) => {
    ok(res, await listWebhooks({ userId: currentUser(req).id }));
  })
);

webhooksRouter.post(
  "/",
  handler(async (req, res) => {
    ok(res, await createWebhook({ userId: currentUser(req).id }, parseWebhookInput(req.body)), 201);
  })
);

webhooksRouter.get(
  "/:webhookId",
  handler(async (req, res) => {
    const row = await queryOne<WebhookRow>(
      `SELECT ${WEBHOOK_COLUMNS} FROM webhooks WHERE uid = $1 AND user_id = $2`,
      [String(req.params.webhookId), currentUser(req).id]
    );
    if (!row) throw notFound("Webhook not found");
    ok(res, serializeWebhook(row));
  })
);

webhooksRouter.patch(
  "/:webhookId",
  handler(async (req, res) => {
    const owned = await queryOne("SELECT 1 FROM webhooks WHERE uid = $1 AND user_id = $2", [
      String(req.params.webhookId),
      currentUser(req).id,
    ]);
    if (!owned) throw notFound("Webhook not found");
    ok(res, await updateWebhook(String(req.params.webhookId), parseWebhookInput(req.body, true)));
  })
);

webhooksRouter.delete(
  "/:webhookId",
  handler(async (req, res) => {
    const row = await queryOne<{ uid: string }>(
      "DELETE FROM webhooks WHERE uid = $1 AND user_id = $2 RETURNING uid",
      [String(req.params.webhookId), currentUser(req).id]
    );
    if (!row) throw notFound("Webhook not found");
    ok(res, { id: row.uid });
  })
);
