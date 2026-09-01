import type { RequestHandler } from 'express'
import { redisClient } from '../redis'
import { TooManyRequestsError } from '../lib/errors'

const WINDOW_MS = 60_000
const WINDOW_SECONDS = WINDOW_MS / 1000
const LIMIT = 60
const PREFIX = 'rate'

export const rateLimiter: RequestHandler = async (req, res, next) => {
  const now = Date.now()
  const window = Math.floor(now / WINDOW_MS) // which WINDOW_MS block we are in
  const elapsed = (now % WINDOW_MS) / WINDOW_MS // how far through it: 0 -> 1

  const id = req.ip
  const currentKey = `${PREFIX}:${id}:${window}`
  const previousKey = `${PREFIX}:${id}:${window - 1}`
  let replies
  try {
    replies = await redisClient
      .multi()
      .incr(currentKey)
      .expire(currentKey, WINDOW_SECONDS * 2, 'NX')
      .get(previousKey)
      .execTyped()
  } catch (err) {
    console.error('Redis connection issue:', err)
    return next()
  }

  const [current, , previous] = replies

  const estimate = Number(previous ?? 0) * (1 - elapsed) + current
  if (estimate > LIMIT) {
    const retryAfter = Math.max(Math.ceil((WINDOW_MS - (now % WINDOW_MS)) / 1000), 1)
    return next(
      new TooManyRequestsError(retryAfter, `Too many requests. Try again in ${retryAfter} seconds`),
    )
  }

  next()
}
