// In-memory fixed-window rate limiting. Enough for the single-process deployment
// this app ships as; a multi-process setup would need a shared store.

import type { RequestHandler } from "express";
import { ApiError } from "./errors.ts";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Requests allowed per window, per client. */
  limit: number;
  windowMs: number;
  /** Used in the error message so callers know which limit they hit. */
  name: string;
}

/** Best-effort client identity. There is no trusted proxy header here, so the
 *  socket address is the only thing a caller cannot simply set. */
function clientKey(ip: string | undefined, extra: string): string {
  return `${ip ?? "unknown"}|${extra}`;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req.ip, options.name);

    // Sweep expired buckets so the map cannot grow without bound.
    if (buckets.size > 5000) {
      for (const [existing, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(existing);
      }
    }

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("retry-after", String(retryAfter));
      next(
        new ApiError(
          429,
          "TooManyRequestsException",
          `Too many ${options.name} attempts — try again in ${retryAfter}s`
        )
      );
      return;
    }
    next();
  };
}
