export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, "BadRequestException", message, details);
export const unauthorized = (message = "Unauthorized"): ApiError =>
  new ApiError(401, "UnauthorizedException", message);
export const forbidden = (message = "Forbidden"): ApiError =>
  new ApiError(403, "ForbiddenException", message);
export const notFound = (message = "Not found"): ApiError =>
  new ApiError(404, "NotFoundException", message);
export const conflict = (message: string): ApiError =>
  new ApiError(409, "ConflictException", message);
