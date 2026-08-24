import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "./errors.ts";

// cal.com API v2 wraps everything in { status, data } / { status, error }.
export function ok<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ status: "success", data });
}

export function okPaginated<T>(
  res: Response,
  data: T[],
  pagination: { nextCursor?: string | null; hasNextPage?: boolean } = {}
): void {
  res.status(200).json({ status: "success", data, pagination });
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function handler(fn: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      status: "error",
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  console.error(error);
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({
    status: "error",
    error: { code: "InternalServerError", message },
  });
}

export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({
    status: "error",
    error: { code: "NotFoundException", message: `Cannot ${req.method} ${req.path}` },
  });
}
