// Image uploads for avatars and team logos.
//
// Images arrive as a base64 data URL in JSON rather than multipart, which keeps
// the server dependency-free. The claimed content type is never trusted: the
// bytes are sniffed, and only real images of a known kind are written.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { requireAuth } from "../../auth/middleware.ts";
import { env } from "../../env.ts";
import { badRequest } from "../../http/errors.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import { asObject, str } from "../../http/validate.ts";
import { handler, ok } from "../../http/respond.ts";
import { uploadsDir } from "../../lib/uploads.ts";
import { sniffImage } from "./sniff.ts";

export const uploadsRouter: Router = Router();

uploadsRouter.post(
  "/image",
  requireAuth,
  // Writing files is cheap but not free, and there is no reason for a burst.
  rateLimit({ limit: 20, windowMs: 60_000, name: "image upload" }),
  handler(async (req, res) => {
    const body = asObject(req.body);
    const dataUrl = str(body, "dataUrl", { max: env.uploads.maxBytes * 2 });

    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl.trim());
    if (!match) throw badRequest("Expected a base64 image data URL");

    let bytes: Buffer;
    try {
      bytes = Buffer.from(match[2], "base64");
    } catch {
      throw badRequest("The image could not be decoded");
    }
    if (bytes.length === 0) throw badRequest("The image is empty");
    if (bytes.length > env.uploads.maxBytes) {
      const mb = Math.round(env.uploads.maxBytes / 1024 / 1024);
      throw badRequest(`Images must be ${mb}MB or smaller`);
    }

    const signature = sniffImage(bytes);
    if (!signature) throw badRequest("Only PNG, JPEG, GIF and WebP images are supported");

    // Content-addressed, so re-uploading the same picture reuses one file and
    // the name gives away nothing about who uploaded it.
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const filename = `${digest}.${signature.ext}`;
    const dir = uploadsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), bytes);

    ok(res, { url: `${env.uploads.publicPath}/${filename}` }, 201);
  })
);
