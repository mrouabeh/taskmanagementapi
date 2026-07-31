import { Router } from 'express'
import { ConflictError, InternalError, UnauthorizedError, ValidationError } from '../lib/errors'
import { auth } from '../middleware/auth'
import { db } from '../db'
import { passwordResetTokens, users } from '../db/schema'
import { and, eq, gt } from 'drizzle-orm'
import { isOverLimit, rateLimiter } from '../middleware/rateLimiter'
import {
  forgotPasswordSchema,
  loginUserSchema,
  registerUserSchema,
  resetPasswordSchema,
} from '../validation/auth.schema'
import bcrypt from 'bcrypt'
import jwt, { JwtPayload } from 'jsonwebtoken'
import { env } from '../config/env'
import { redisClient } from '../redis'
import { randomBytes, createHash } from 'node:crypto'
import { revokeAllSessions, trackSession, untrackSession } from '../lib/sessions'
import { emailQueue, enqueueSafely } from '../queue/queues'
const DUMMY_HASH = '$2b$10$KIqRWTBXtc/obFflqazVnuCWXlQynmdTqcjNJbKCwPheOxXpsFqEG'
const router = Router()

router.get('/me', auth, async (req, res) => {
  const r = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, req.user!.sub))
    .limit(1)
  if (!r[0]) {
    // Valid token, but the user is gone — treat as unauthenticated.
    throw new UnauthorizedError('Authentication unverified')
  }
  return res.json({ success: true, user: r[0] })
})

router.post('/login', rateLimiter, async (req, res) => {
  const result = loginUserSchema.safeParse(req.body)
  if (!result.success) {
    throw new ValidationError(result.error.flatten())
  }
  const { email, password } = result.data
  const normalizedEmail = email.toLowerCase().trim()
  const userResult = await db
    .select({
      id: users.id,
      hashedpassword: users.hashedpassword,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)
  const user = userResult[0]
  // Always run a compare, even with no user or a null stored hash, so response
  // time doesn't reveal whether the account exists.
  const passwordResult = await bcrypt.compare(password, user?.hashedpassword ?? DUMMY_HASH)
  if (!user || !passwordResult) {
    // Same message for both cases so we don't confirm which emails exist.
    throw new UnauthorizedError('Invalid email or password.')
  }
  console.log(`Success! Welcome ${user.name}`)
  const sid = crypto.randomUUID()
  const token = jwt.sign({ sub: user.id, sid }, env.JWT_SECRET, {
    expiresIn: '15m',
    jwtid: crypto.randomUUID(),
  })
  res.cookie('token', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 900000,
  })
  const refreshJti = crypto.randomUUID()
  const refreshToken = jwt.sign({ sub: user.id, sid }, env.REFRESH_SECRET, {
    expiresIn: '30d',
    jwtid: refreshJti,
  })
  await redisClient.set(`family:${sid}`, refreshJti, { EX: 60 * 60 * 24 * 30 })
  // Reverse index, so a password reset can find and kill this session later.
  await trackSession(user.id, sid)
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth/refresh',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  })
  return res.status(200).json({
    success: true,
    message: 'User logged in successfully!',
    user: {
      id: user.id,
      email: user.email,
    },
  })
})
// No `auth` here — the access token is expected to be expired by the time a
// client calls this. The refresh cookie is the only credential.
router.post('/refresh', rateLimiter, async (req, res) => {
  const presented = req.cookies.refreshToken
  if (!presented) throw new UnauthorizedError('Not authenticated')

  let payload: string | JwtPayload
  try {
    payload = jwt.verify(presented, env.REFRESH_SECRET)
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
  if (typeof payload === 'string') {
    throw new UnauthorizedError('Malformed token payload')
  }
  const sub = Number(payload.sub)
  if (!Number.isInteger(sub) || sub <= 0) {
    throw new UnauthorizedError('Malformed token payload')
  }
  const { jti, sid } = payload
  if (typeof jti !== 'string' || typeof sid !== 'string') {
    throw new UnauthorizedError('Malformed token payload')
  }

  const current = await redisClient.get(`family:${sid}`)
  if (!current) {
    // Checked before the mismatch case: `null !== jti` is also true.
    throw new UnauthorizedError('Session expired')
  }
  if (current !== jti) {
    // A spent token was replayed. We can't tell the thief from the victim,
    // so kill the whole family and make both re-authenticate.
    await redisClient.del(`family:${sid}`)
    throw new UnauthorizedError('Session revoked')
  }

  const newJti = crypto.randomUUID()
  const newRefreshToken = jwt.sign({ sub, sid }, env.REFRESH_SECRET, {
    expiresIn: '30d',
    jwtid: newJti,
  })
  // KEEPTTL keeps the original 30-day deadline; a fresh EX would let an active
  // session renew itself forever.
  await redisClient.set(`family:${sid}`, newJti, { KEEPTTL: true })

  const newAccessToken = jwt.sign({ sub, sid }, env.JWT_SECRET, {
    expiresIn: '15m',
    jwtid: crypto.randomUUID(),
  })
  res.cookie('token', newAccessToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 900000,
  })
  res.cookie('refreshToken', newRefreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth/refresh',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  })
  return res.json({ success: true, message: 'Token refreshed' })
})

router.post('/logout', auth, async (req, res) => {
  const { jti, exp, sid } = req.user!
  const ttl = exp - Math.floor(Date.now() / 1000)
  if (ttl > 0) {
    await redisClient.set(`denylist:${jti}`, '1', { EX: ttl })
  }
  await redisClient.del(`family:${sid}`)
  await untrackSession(req.user!.sub, sid)
  res.clearCookie('token', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
  })
  // `path` must match what the cookie was set with or this clears nothing.
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth/refresh',
  })
  return res.json({ success: true, message: 'Logged out' })
})
router.post('/register', rateLimiter, async (req, res) => {
  const result = registerUserSchema.safeParse(req.body)
  if (!result.success) {
    throw new ValidationError(result.error.flatten())
  }
  const { name, email, password } = result.data
  const normalizedEmail = email.toLowerCase().trim()
  const emailResult = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)
  if (emailResult.length > 0) {
    throw new ConflictError('A user with this email already exists!')
  }
  const hashedPassword = await bcrypt.hash(password, 10)

  let insertResult
  try {
    insertResult = await db
      .insert(users)
      .values({ name, email: normalizedEmail, hashedpassword: hashedPassword })
      .returning({ id: users.id, email: users.email })
  } catch (err) {
    // Two concurrent signups can both pass the check above; the unique index
    // is what actually decides. 23505 = unique_violation. drizzle 1.0-rc wraps
    // DB errors, so the code can sit on `.cause` rather than the top level.
    const code =
      (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
    if (code === '23505') {
      throw new ConflictError('A user with this email already exists!')
    }
    throw err
  }
  if (!insertResult || insertResult.length === 0) {
    throw new InternalError('The database failed to create the user record.')
  }
  const newUser = insertResult[0]
  console.log(`Success! User created with ID: ${newUser.id}`)
  return res.status(201).json({
    success: true,
    message: 'User registered successfully!',
    user: {
      id: newUser.id,
      email: newUser.email,
    },
  })
})
router.post('/forgot-password', rateLimiter, async (req, res) => {
  const result = forgotPasswordSchema.safeParse(req.body)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const email = result.data.email.toLowerCase().trim()
  // Per-address cap on top of the per-IP middleware, so rotating IPs can't
  // mailbomb one inbox. Tripping it returns the same body as everything else —
  // a distinct response would itself say whether the address is registered.
  const flooding = await isOverLimit(`rate:reset:${email}`, 3, 60 * 60)
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (user && !flooding) {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    // Swallows enqueue failures on purpose: throwing only for accounts that
    // exist would turn a 500 into an account-enumeration oracle. The cost is a
    // silent no-send, so this log needs to be one that alerting actually reads.
    await enqueueSafely(emailQueue, 'password-reset', {
      to: user.email,
      name: user.name,
      token,
    })
  }
  // Identical response whether or not the address is registered.
  return res.json({
    success: true,
    message: 'If that email is registered, a reset link has been sent.',
  })
})
router.post('/reset-password', rateLimiter, async (req, res) => {
  const result = resetPasswordSchema.safeParse(req.body)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { token, password } = result.data
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const [row] = await db
    .delete(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: passwordResetTokens.userId })
  if (!row) throw new UnauthorizedError('Invalid or expired reset token')
  const hashedPassword = await bcrypt.hash(password, 10)
  await db.update(users).set({ hashedpassword: hashedPassword }).where(eq(users.id, row.userId))
  await revokeAllSessions(row.userId)
  return res.json({ success: true, message: 'Password updated. Please log in again.' })
})
export default router
