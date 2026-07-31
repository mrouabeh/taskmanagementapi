/**
 * Operational errors — ones we threw on purpose, with an HTTP status and a
 * stable machine-readable code the client can branch on.
 *
 * Anything that is NOT an AppError reaching the error handler is a bug, and is
 * reported as a generic 500 so we never leak internals.
 */
export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.status = status
    this.code = code
    this.details = details
    Error.captureStackTrace?.(this, new.target)
  }
}

/** 400 — request body/params failed schema validation. `details` carries the zod field errors. */
export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Validation failed') {
    super(message, 400, 'VALIDATION_FAILED', details)
  }
}

/** 401 — missing, invalid, or expired credentials. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Not authenticated') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

/** 403 — authenticated, but not allowed to do this. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN')
  }
}

/** 404 — the addressed resource does not exist. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND')
  }
}

/** 409 — request conflicts with current state, e.g. duplicate email on register. */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT')
  }
}

/** 429 — rate limit tripped. `retryAfter` is seconds, surfaced as the Retry-After header. */
export class TooManyRequestsError extends AppError {
  readonly retryAfter: number

  constructor(retryAfter: number, message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED')
    this.retryAfter = retryAfter
  }
}

/** 500 — something we control failed in a way we can describe but not recover from. */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR')
  }
}
