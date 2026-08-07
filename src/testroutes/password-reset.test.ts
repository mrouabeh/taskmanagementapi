import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import app from '../app'
import { db } from '../db'
import { users } from '../db/schema'
import { emailQueue } from '../queue/emailQueue'

// Unique email so re-running the tests never hits the unique index.
const email = `reset-test-${Date.now()}@example.com`

beforeAll(async () => {
  await db.insert(users).values({ name: 'Reset Test', email, hashedpassword: null })
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, email))
})

// No worker runs in tests, so the job just sits in the queue and we can read
// the token straight out of it.
async function tokenFromQueue() {
  const jobs = await emailQueue.getJobs()
  return jobs[0].data.token
}

describe('password reset', () => {
  it('says the same thing for an email that does not exist', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'nobody@example.com' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('rejects a made-up token', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'a'.repeat(43), password: 'NewPassword123!' })

    expect(res.status).toBe(401)
  })

  it('changes the password, and the new one works', async () => {
    await request(app).post('/auth/forgot-password').send({ email })
    const token = await tokenFromQueue()

    const reset = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'NewPassword123!' })
    expect(reset.status).toBe(200)

    const login = await request(app)
      .post('/auth/login')
      .send({ email, password: 'NewPassword123!' })
    expect(login.status).toBe(200)
  })

  it('refuses the same token twice', async () => {
    await request(app).post('/auth/forgot-password').send({ email })
    const token = await tokenFromQueue()

    const first = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'Second123!' })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'Third123!' })
    expect(second.status).toBe(401)
  })
})
