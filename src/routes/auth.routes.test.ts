import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { CookieAccessInfo } from 'cookiejar'
import app from '../app'
import { db } from '../db'
import { users } from '../db/schema'

// Unique per run so repeated test runs don't collide on the email unique index.
const email = `test-${Date.now()}@example.com`

// Real rows get written to the dev DB — remove them when the file finishes.
afterAll(async () => {
    await db.delete(users).where(eq(users.email, email))
})

describe('POST /auth/register', () => {
    it('creates user and returns 201', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ name: 'Test', email, password: 'Password123!' })

        expect(res.status).toBe(201)
        expect(res.body.success).toBe(true)
        expect(res.body.user.email).toBe(email)
    })

    it('rejects short password with 400', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ name: 'Test', email: `x-${Date.now()}@example.com`, password: 'short' })

        expect(res.status).toBe(400)
    })
})

describe('POST /auth/login',()=>{
    it('performs login and returns 200 if email and password match in the database',async ()=>{
        const res = await request(app)
            .post('/auth/login')
            .send({email,password:`Password123!`})
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.user.email).toBe(email)
    })
    it('rejects wrong password or invalid email',async()=>{
        const res = await request(app)
            .post('/auth/login')
            .send({email,password:`azertyuoip`})
        expect(res.status).toBe(401)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toBe("Invalid email or password.")
    })
})

describe('POST /auth/refresh', () => {
    it('refreshes with a valid token and returns 200', async () => {
        // An agent remembers cookies like a browser: after login it already
        // holds the refresh cookie, so the next request carries it automatically.
        const agent = request.agent(app)
        await agent.post('/auth/login').send({ email, password: 'Password123!' })

        const res = await agent.post('/auth/refresh')
        expect(res.status).toBe(200)
    })

    it('rejects a reused (already-rotated) refresh token', async () => {
        const agent = request.agent(app)
        await agent.post('/auth/login').send({ email, password: 'Password123!' })

        // Copy the refresh cookie the agent is holding, formatted as "name=value".
        // This is the token we'll replay, like a thief who kept an old copy.
        const oldCookie = agent.jar
            .getCookies(CookieAccessInfo.All)
            .find((c) => c.name === 'refreshToken')!
            .toValueString()

        // First use: still the current token, so it rotates and succeeds.
        const first = await request(app).post('/auth/refresh').set('Cookie', oldCookie)
        expect(first.status).toBe(200)

        // Second use of the SAME token: it was rotated away, so this is a replay.
        const second = await request(app).post('/auth/refresh').set('Cookie', oldCookie)
        expect(second.status).toBe(401)
    })
})
