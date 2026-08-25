/** URL guards. Event-type owners supply some of these strings, so nothing here
 *  may end up navigating the app to a `javascript:` or `data:` URL. */

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/** Returns the URL only when it is a plain http(s) link, otherwise null. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
  return parsed.toString();
}

/** Opens a link in a new tab without handing it a reference to this window. */
export function openExternal(raw: string): void {
  const url = safeExternalUrl(raw);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
