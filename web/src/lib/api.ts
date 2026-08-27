// Fetch wrapper: attaches the JWT, refreshes it once on 401, unwraps the
// cal.com { status, data } envelope.

const ACCESS_KEY = "cal.accessToken";
const REFRESH_KEY = "cal.refreshToken";
const API_VERSION = "2024-08-13";

export interface ApiEnvelope<T> {
  status: "success" | "error";
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  pagination?: { hasNextPage?: boolean; nextCursor?: string | null };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const tokens = {
  access: (): string | null => localStorage.getItem(ACCESS_KEY),
  refresh: (): string | null => localStorage.getItem(REFRESH_KEY),
  set(accessToken: string, refreshToken?: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  signal?: AbortSignal;
}

async function rawRequest<T>(path: string, options: RequestOptions, retry = true): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${window.location.origin}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { "cal-api-version": API_VERSION };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const accessToken = tokens.access();
  if (accessToken && options.auth !== false) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 401 && retry && tokens.refresh()) {
    const refreshed = await refreshTokens();
    if (refreshed) return rawRequest<T>(path, options, false);
  }

  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.status === "error") {
    throw new ApiError(
      response.status,
      payload.error?.code ?? "RequestFailed",
      payload.error?.message ?? `Request failed with ${response.status}`
    );
  }
  return payload.data as T;
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokens.refresh();
  if (!refreshToken) return false;
  try {
    const response = await fetch("/v2/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "cal-api-version": API_VERSION },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = (await response.json()) as ApiEnvelope<{ accessToken: string; refreshToken: string }>;
    if (!response.ok || !payload.data) {
      tokens.clear();
      return false;
    }
    tokens.set(payload.data.accessToken, payload.data.refreshToken);
    return true;
  } catch {
    tokens.clear();
    return false;
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], options: RequestOptions = {}) =>
    rawRequest<T>(path, { ...options, method: "GET", query }),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    rawRequest<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    rawRequest<T>(path, { ...options, method: "PATCH", body }),
  /** For endpoints that replace a whole collection rather than merge fields. */
  put: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    rawRequest<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options: RequestOptions = {}) =>
    rawRequest<T>(path, { ...options, method: "DELETE" }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
