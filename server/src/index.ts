import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { env } from "./env.ts";
import { errorMiddleware, notFoundMiddleware, ok } from "./http/respond.ts";
import { authRouter } from "./modules/auth/routes.ts";
import { bookingsRouter } from "./modules/bookings/routes.ts";
import { calendarsRouter } from "./modules/calendars/routes.ts";
import { eventTypesRouter } from "./modules/event-types/routes.ts";
import { meRouter } from "./modules/me/routes.ts";
import { organizationsRouter } from "./modules/organizations/routes.ts";
import { publicRouter } from "./modules/public/routes.ts";
import { uploadsRouter } from "./modules/uploads/routes.ts";
import { uploadsDir } from "./lib/uploads.ts";
import { schedulesRouter } from "./modules/schedules/routes.ts";
import { slotsRouter } from "./modules/slots/routes.ts";
import { teamsRouter } from "./modules/teams/routes.ts";
import { webhooksRouter } from "./modules/webhooks/routes.ts";

export function createApp(): express.Express {
  const app = express();

  // Nothing good comes of telling callers which server this is.
  app.disable("x-powered-by");
  // Trust only the immediate proxy, so `req.ip` cannot be spoofed by a client
  // that simply sets `x-forwarded-for` itself.
  app.set("trust proxy", 1);

  // A base64 image is a third larger than the file it encodes, so the upload
  // route gets its own parser. It is mounted first; body-parser marks the body
  // as read, so the global parser below skips it.
  app.use("/v2/uploads/image", express.json({ limit: `${env.uploads.maxBytes * 2}b` }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  app.use((_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    res.setHeader("x-frame-options", "SAMEORIGIN");
    res.setHeader("cross-origin-opener-policy", "same-origin");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use((req, res, next) => {
    const origin = req.header("origin");
    // A wildcard origin cannot be combined with credentials — browsers reject it,
    // and echoing an arbitrary origin back with credentials defeats CORS entirely.
    if (env.webOrigin === "*") {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "authorization, content-type, cal-api-version");
      res.setHeader("access-control-allow-methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    } else if (origin === env.webOrigin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-credentials", "true");
      res.setHeader("access-control-allow-headers", "authorization, content-type, cal-api-version");
      res.setHeader("access-control-allow-methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    ok(res, { status: "up", time: new Date().toISOString() });
  });

  app.use("/v2/auth", authRouter);
  app.use("/v2/me", meRouter);
  app.use("/v2/schedules", schedulesRouter);
  app.use("/v2/event-types", eventTypesRouter);
  app.use("/v2/slots", slotsRouter);
  app.use("/v2/bookings", bookingsRouter);
  app.use("/v2/calendars", calendarsRouter);
  app.use("/v2/teams", teamsRouter);
  app.use("/v2/organizations", organizationsRouter);
  app.use("/v2/webhooks", webhooksRouter);
  app.use("/v2/public", publicRouter);
  app.use("/v2/uploads", uploadsRouter);

  // Uploaded images. Content-addressed names never change, so they can be
  // cached hard; nosniff is already set for every response above.
  const uploads = uploadsDir();
  mkdirSync(uploads, { recursive: true });
  app.use(
    env.uploads.publicPath,
    express.static(uploads, { index: false, maxAge: "30d", immutable: true, fallthrough: false })
  );

  // Optionally serve the built web app from the same process (SERVE_WEB=true).
  if (env.serveWeb) {
    // repoRoot is two levels up from server/src, so WEB_DIST is repo-relative
    // ("web/dist"); an absolute WEB_DIST is used as given.
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const dist = isAbsolute(env.webDist) ? env.webDist : resolve(repoRoot, env.webDist);
    if (existsSync(dist)) {
      app.use(express.static(dist, { index: false, maxAge: "1h" }));
      app.get(/^(?!\/v2\/|\/health).*/, (_req, res) => {
        // The SPA shell must never be cached as a specific route's content.
        res.setHeader("cache-control", "no-cache");
        res.sendFile(join(dist, "index.html"));
      });
      console.log(`serving web app from ${dist}`);
    } else {
      console.warn(`SERVE_WEB is on but ${dist} does not exist — run npm run build first`);
    }
  }

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}

const isMain = process.argv[1]?.endsWith("index.ts");
if (isMain) {
  const app = createApp();
  app.listen(env.apiPort, () => {
    console.log(`API listening on http://localhost:${env.apiPort}`);
    // Report what the login page will actually offer: OIDC needs to be configured too.
    const oidcReady = env.oidc.enabled && Boolean(env.oidc.issuer && env.oidc.clientId);
    const googleConfigured = Boolean(env.google.clientId && env.google.clientSecret);
    const flag = (enabled: boolean): string =>
      enabled ? (googleConfigured ? "on" : "enabled but not configured") : "off";
    console.log(
      `auth: oidc=${oidcReady ? "on" : env.oidc.enabled ? "enabled but not configured" : "off"} ` +
        `google=${flag(env.google.loginEnabled)} guest=${env.guest.enabled ? "on" : "off"}`
    );
    console.log(`google calendar: ${flag(env.google.calendarEnabled)}`);
  });
}
