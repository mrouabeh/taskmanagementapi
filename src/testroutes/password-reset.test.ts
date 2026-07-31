import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import app from '../app'
import { db } from '../db'
import { passwordResetTokens, users } from '../db/schema'
import { emailQueue } from '../queue/queues'
import { redisClient } from '../redis'
import type { PasswordResetEmail } from '../queue/queues'

// Unique per run so repeated runs don't collide on the email unique index.
const email = `reset-${Date.now()}@example.com`
const password = 'Password123!'
let userId: number

// No worker runs in the test process, so jobs stay queued and can be inspected.
// setup.ts clears the prefix before each test, so this only ever sees one.
async function takeResetToken() {
  const jobs = await emailQueue.getJobs(['waiting', 'delayed', 'prioritized'])
  const job = jobs.find((j) => j.name === 'password-reset')
  return (job?.data as PasswordResetEmail | undefined)?.token
}

beforeAll(async () => {
  const [row] = await db
    .insert(users)
    .values({ name: 'Reset Test', email, hashedpassword: null })
    .returning({ id: users.id })
  userId = row.id
})

afterAll(async () => {
  // password_reset_tokens cascades on user delete.
  await db.delete(users).where(eq(users.email, email))
  await redisClient.del(`sessions:${userId}`)
})

describe('POST /auth/forgot-password', () => {
  it('stores a hashed token and queues an email for a known address', async () => {
    const res = await request(app).post('/auth/forgot-password').send({ email })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const token = await takeResetToken()
    expect(token).toBeTypeOf('string')

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId))
    expect(rows).toHaveLength(1)
    // The raw token must never be what's stored.
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(token!).digest('hex'))
    expect(rows[0].tokenHash).not.toBe(token)
  })

  it('answers unknown addresses identically and queues nothing', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: `nobody-${Date.now()}@example.com` })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('If that email is registered, a reset link has been sent.')
    expect(await takeResetToken()).toBeUndefined()
  })

  it('replaces the previous token instead of stacking them', async () => {
    await request(app).post('/auth/forgot-password').send({ email })
    const first = await takeResetToken()
    await emailQueue.drain()
    await request(app).post('/auth/forgot-password').send({ email })
    const second = await takeResetToken()

    expect(second).not.toBe(first)
    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId))
    expect(rows).toHaveLength(1)
  })
})

describe('POST /auth/reset-password', () => {
  it('rejects a token that was never issued', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'a'.repeat(43), password: 'Whatever123!' })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Invalid or expired reset token')
  })

  it('rejects an expired token', async () => {
    await request(app).post('/auth/forgot-password').send({ email })
    const token = await takeResetToken()
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokens.userId, userId))

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'Whatever123!' })

    expect(res.status).toBe(401)
  })

  it('sets the new password, consumes the token, and kills existing sessions', async () => {
    await request(app).post('/auth/forgot-password').send({ email })
    const token = await takeResetToken()

    // A live session that the reset must invalidate.
    await redisClient.sAdd(`sessions:${userId}`, 'stale-sid')
    await redisClient.set('family:stale-sid', 'stale-jti')

    const res = await request(app).post('/auth/reset-password').send({ token, password })
    expect(res.status).toBe(200)

    expect(await redisClient.get('family:stale-sid')).toBeNull()
    expect(await redisClient.sMembers(`sessions:${userId}`)).toHaveLength(0)

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId))
    expect(rows).toHaveLength(0)

    const login = await request(app).post('/auth/login').send({ email, password })
    expect(login.status).toBe(200)
  })

  it('refuses to reuse a spent token', async () => {
    await request(app).post('/auth/forgot-password').send({ email })
    const token = await takeResetToken()

    const first = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'Rotated123!' })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'Rotated456!' })
    expect(second.status).toBe(401)
  })
})
