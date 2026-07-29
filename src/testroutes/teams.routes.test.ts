import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { eq, like, inArray } from 'drizzle-orm'
import app from '../app'
import { db } from '../db'
import { users, organizations, teams, projects } from '../db/schema'
import { redisClient } from '../redis'

const stamp = Date.now()
const password = 'Password123!'
const ownerEmail = `smk-owner-${stamp}@example.com`
const outsiderEmail = `smk-out-${stamp}@example.com`

const owner = request.agent(app)
const outsider = request.agent(app)
let orgA: number
let orgB: number

async function resetRateLimit() {
    const keys = await redisClient.keys('rate:*')
    if (keys.length) await redisClient.del(keys)
}

beforeAll(async () => {
    await resetRateLimit()
    await owner.post('/auth/register').send({ name: 'o', email: ownerEmail, password })
    await owner.post('/auth/login').send({ email: ownerEmail, password })
    await resetRateLimit()
    await outsider.post('/auth/register').send({ name: 'x', email: outsiderEmail, password })
    await outsider.post('/auth/login').send({ email: outsiderEmail, password })

    orgA = (await owner.post('/orgs').send({ name: 'A', slug: `a-${stamp}` })).body.organization.id
    orgB = (await owner.post('/orgs').send({ name: 'B', slug: `b-${stamp}` })).body.organization.id
})

afterAll(async () => {
    await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
    await db.delete(users).where(inArray(users.email, [ownerEmail, outsiderEmail]))
})

describe('teams smoke', () => {
    it('POST creates, GET lists and reads', async () => {
        const created = await owner.post(`/orgs/${orgA}/teams`).send({ name: 'Design' })
        expect(created.status).toBe(201)
        expect(created.body.team.name).toBe('Design')

        const list = await owner.get(`/orgs/${orgA}/teams`)
        expect(list.status).toBe(200)
        expect(list.body.teams).toHaveLength(1)

        const one = await owner.get(`/orgs/${orgA}/teams/${created.body.team.id}`)
        expect(one.status).toBe(200)
        expect(one.body.team.name).toBe('Design')
    })

    it('409s on a duplicate name but allows it in another org', async () => {
        await owner.post(`/orgs/${orgA}/teams`).send({ name: 'Dupe' })
        expect((await owner.post(`/orgs/${orgA}/teams`).send({ name: 'Dupe' })).status).toBe(409)
        expect((await owner.post(`/orgs/${orgB}/teams`).send({ name: 'Dupe' })).status).toBe(201)
    })

    it('PATCH renames, and 409s onto an existing name', async () => {
        const t = (await owner.post(`/orgs/${orgA}/teams`).send({ name: 'Old' })).body.team
        const r = await owner.patch(`/orgs/${orgA}/teams/${t.id}`).send({ name: 'New' })
        expect(r.status).toBe(200)
        expect(r.body.team.name).toBe('New')

        expect((await owner.patch(`/orgs/${orgA}/teams/${t.id}`).send({ name: 'Design' })).status).toBe(409)
    })

    it('scopes every id route to the org', async () => {
        const foreign = (await owner.post(`/orgs/${orgB}/teams`).send({ name: 'Foreign' })).body.team

        expect((await owner.get(`/orgs/${orgA}/teams/${foreign.id}`)).status).toBe(404)
        expect((await owner.patch(`/orgs/${orgA}/teams/${foreign.id}`).send({ name: 'X' })).status).toBe(404)
        expect((await owner.delete(`/orgs/${orgA}/teams/${foreign.id}`)).status).toBe(404)

        const rows = await db.select().from(teams).where(eq(teams.id, foreign.id))
        expect(rows).toHaveLength(1)
    })

    it('DELETE removes an empty team but refuses a non-empty one', async () => {
        const empty = (await owner.post(`/orgs/${orgA}/teams`).send({ name: 'Empty' })).body.team
        expect((await owner.delete(`/orgs/${orgA}/teams/${empty.id}`)).status).toBe(200)

        const full = (await owner.post(`/orgs/${orgA}/teams`).send({ name: 'Full' })).body.team
        await db.insert(projects).values({ teamId: full.id, name: 'P1' })
        expect((await owner.delete(`/orgs/${orgA}/teams/${full.id}`)).status).toBe(409)

        const still = await db.select().from(teams).where(eq(teams.id, full.id))
        expect(still).toHaveLength(1)
    })

    it('400s on a malformed teamId and empty body, 404s for a non-member', async () => {
        expect((await owner.get(`/orgs/${orgA}/teams/12abc`)).status).toBe(400)
        const t = (await owner.post(`/orgs/${orgA}/teams`).send({ name: 'Body' })).body.team
        expect((await owner.patch(`/orgs/${orgA}/teams/${t.id}`).send({})).status).toBe(400)
        expect((await outsider.get(`/orgs/${orgA}/teams`)).status).toBe(404)
    })
})
