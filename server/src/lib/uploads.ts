// Where uploaded avatars and logos live on disk.
import { resolve } from "node:path";
import { env } from "../env.ts";

/**
 * Absolute path to the upload directory. Resolved from the working directory so
 * a relative UPLOAD_DIR behaves the same however the server is started.
 */
export function uploadsDir(): string {
  return resolve(process.cwd(), env.uploads.dir);
}
