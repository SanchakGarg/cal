// Hand-written validation, shaped after the cal.com v2 DTOs in docs/calspec.json.
// Each helper reads one field off an unknown object and throws ApiError(400).

import { badRequest } from "./errors.ts";
import { isValidTimeZone } from "../lib/tz.ts";

export type Json = Record<string, unknown>;

export function asObject(value: unknown, label = "body"): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${label} must be an object`);
  }
  return value as Json;
}

export function optional<T>(value: T | undefined | null): T | undefined {
  return value === undefined || value === null ? undefined : value;
}

export function str(body: Json, field: string, opts: { max?: number } = {}): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${field} is required and must be a non-empty string`);
  }
  if (opts.max && value.length > opts.max) {
    throw badRequest(`${field} must be at most ${opts.max} characters`);
  }
  return value;
}

export function optStr(body: Json, field: string, opts: { max?: number } = {}): string | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  const value = body[field];
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  if (opts.max && value.length > opts.max) {
    throw badRequest(`${field} must be at most ${opts.max} characters`);
  }
  return value;
}

export function int(body: Json, field: string, opts: { min?: number; max?: number } = {}): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} is required and must be a number`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw badRequest(`${field} must be at least ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw badRequest(`${field} must be at most ${opts.max}`);
  }
  return value;
}

export function optInt(
  body: Json,
  field: string,
  opts: { min?: number; max?: number } = {}
): number | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return int(body, field, opts);
}

export function bool(body: Json, field: string, fallback: boolean): boolean {
  const value = body[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw badRequest(`${field} must be a boolean`);
  return value;
}

export function optBool(body: Json, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${field} must be a boolean`);
  return value;
}

export function oneOf<T extends string>(
  body: Json,
  field: string,
  allowed: readonly T[],
  required: true
): T;
export function oneOf<T extends string>(
  body: Json,
  field: string,
  allowed: readonly T[],
  required?: false
): T | undefined;
export function oneOf<T extends string>(
  body: Json,
  field: string,
  allowed: readonly T[],
  required = false
): T | undefined {
  const value = body[field];
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required (one of ${allowed.join(", ")})`);
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw badRequest(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function array(body: Json, field: string, opts: { required?: boolean } = {}): unknown[] {
  const value = body[field];
  if (value === undefined || value === null) {
    if (opts.required) throw badRequest(`${field} is required and must be an array`);
    return [];
  }
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  return value;
}

export function optArray(body: Json, field: string): unknown[] | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return array(body, field);
}

export function timeZone(body: Json, field: string): string {
  const value = str(body, field);
  if (!isValidTimeZone(value)) throw badRequest(`${field} must be a valid IANA time zone`);
  return value;
}

export function optTimeZone(body: Json, field: string): string | undefined {
  const value = optStr(body, field);
  if (value === undefined) return undefined;
  if (!isValidTimeZone(value)) throw badRequest(`${field} must be a valid IANA time zone`);
  return value;
}

const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts `HH:MM` and the `HH:MM:SS` that Postgres returns. */
export function timeHHMM(value: unknown, label: string): string {
  if (typeof value !== "string") throw badRequest(`${label} must be a string like 09:00`);
  const trimmed = value.length > 5 ? value.slice(0, 5) : value;
  if (!TIME_RE.test(trimmed)) throw badRequest(`${label} must look like 09:00`);
  return trimmed;
}

export function dateISO(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value.slice(0, 10))) {
    throw badRequest(`${label} must look like 2026-08-24`);
  }
  const date = value.slice(0, 10);
  if (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw badRequest(`${label} is not a real date`);
  }
  return date;
}

export function instant(value: unknown, label: string): Date {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw badRequest(`${label} must be an ISO 8601 date-time string`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`${label} is not a valid date-time`);
  return date;
}

export const WEEK_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export type WeekDayName = (typeof WEEK_DAYS)[number];

export function weekDayToNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) {
    return value;
  }
  if (typeof value === "string") {
    const index = WEEK_DAYS.findIndex((day) => day.toLowerCase() === value.toLowerCase());
    if (index !== -1) return index;
  }
  throw badRequest(`${label} must be a weekday name such as Monday`);
}

export function weekDayName(day: number): WeekDayName {
  return WEEK_DAYS[((day % 7) + 7) % 7];
}

/** Reads an integer route/query param. */
export function paramInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw badRequest(`${label} must be an integer`);
  return parsed;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
