import { RequestHandler } from 'express'
import { UnauthorizedError } from '../lib/errors'
import jwt, { JwtPayload } from 'jsonwebtoken'
import { env } from '../config/env'
import { redisClient } from '../redis'

export const auth: RequestHandler = async (req, res, next) => {
  const token = req.cookies.token
  if (!token) throw new UnauthorizedError('Not authenticated')

  let payload: string | JwtPayload
  try {
    payload = jwt.verify(token, env.JWT_SECRET)
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }

  if (typeof payload === 'string') {
    throw new UnauthorizedError('Malformed token payload')
  }

  // A valid signature doesn't guarantee a sensible payload — check `sub` is a real id.
  const sub = Number(payload.sub)
  if (!Number.isSafeInteger(sub) || sub <= 0) {
    throw new UnauthorizedError('Malformed token payload')
  }
  const { jti, exp, sid } = payload
  if (typeof jti !== 'string' || typeof exp !== 'number' || typeof sid !== 'string') {
    throw new UnauthorizedError('Malformed token payload')
  }
  let revoked = false
  try {
    revoked = (await redisClient.exists(`denylist:${jti}`)) === 1
  } catch (err) {
    console.error('Denylist check unavailable, allowing request:', err)
  }
  if (revoked) throw new UnauthorizedError('Token has been revoked')
  req.user = { sub, jti, exp, sid }
  next()
}
