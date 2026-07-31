import { redisClient } from '../redis'
import type { RequestHandler } from 'express'
import { TooManyRequestsError } from '../lib/errors'

/**
 * Counts against an arbitrary key instead of the caller's IP. `rateLimiter` is
 * per-IP, which doesn't stop someone mailbombing one address from rotating IPs.
 *
 * Returns true when the caller is over the limit. Fails open like the
 * middleware: a Redis outage must not break the route.
 */
export async function isOverLimit(key: string, max: number, windowSeconds: number) {
  try {
    const count = await redisClient.incr(key)
    if (count === 1) await redisClient.expire(key, windowSeconds)
    return count > max
  } catch (err) {
    console.error('Redis connection issue:', err)
    return false
  }
}

export const rateLimiter: RequestHandler = async (req, res, next) => {
  const ip = req.ip
  const key = `rate:${ip}`
  let currentRequests: number
  try {
    currentRequests = await redisClient.incr(key)
    if (currentRequests === 1) {
      await redisClient.expire(key, 30)
    }
  } catch (err) {
    console.error('Redis connection issue:', err)
    return next()
  }
  if (currentRequests > 5) {
    const ttl = await redisClient.ttl(key)
    return next(new TooManyRequestsError(ttl, `Too many requests. Try again in ${ttl} seconds`))
  }
  next()
}
