import type { ErrorRequestHandler, RequestHandler } from 'express'
import { env } from '../config/env'
import { AppError, TooManyRequestsError } from '../lib/errors'
import { ZodError } from 'zod'

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.path}`,
  })
}

/**
 * Single exit point for every error in the app. Must be mounted last, and must
 * keep all four parameters — Express identifies error middleware by arity.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Response already began streaming; only Express can safely tear it down now.
  if (res.headersSent) return next(err)

  if (err instanceof AppError) {
    // 5xx means we broke, not the caller — worth a log line even though it's typed.
    if (err.status >= 500) {
      console.error(`[${err.code}] ${req.method} ${req.path}:`, err)
    }
    if (err instanceof TooManyRequestsError) {
      res.set('Retry-After', String(err.retryAfter))
    }
    return res.status(err.status).json({
      success: false,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    })
  }

  // express.json() rejects malformed bodies before any route runs.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      message: 'Invalid JSON payload',
    })
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: err.flatten().fieldErrors,
    })
  }

  // Unexpected: a real bug. Log it in full, tell the client nothing.
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err)
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    ...(env.NODE_ENV !== 'production' && {
      debug: err instanceof Error ? err.message : String(err),
    }),
  })
}
