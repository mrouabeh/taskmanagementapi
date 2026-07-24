import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { eq, like, inArray } from 'drizzle-orm'
import app from '../app'
import { db } from '../db'
import { users, organizations, memberships } from '../db/schema'
import { redisClient } from '../redis'

// Unique per run so repeated runs don't collide on the slug/email unique indexes.
const stamp = Date.now()
const password = 'Password123!'

const ownerEmail = `org-owner-${stamp}@example.com`
const adminEmail = `org-admin-${stamp}@example.com`
const memberEmail = `org-member-${stamp}@example.com`
const outsiderEmail = `org-outsider-${stamp}@example.com`

// An agent remembers login cookies like a browser, so it stays logged in.
const owner = request.agent(app)
const admin = request.agent(app)
const member = request.agent(app)
const outsider = request.agent(app)

let adminId: number
let memberId: number

// /auth/* is rate limited to 5 requests per window per IP. Clear the limiter's
// keys before each register+login pair so the four sign-ups stay under it.
async function resetRateLimit() {
    const keys = await redisClient.keys('rate:*')
    if (keys.length) await redisClient.del(keys)
}

beforeAll(async () => {
    await resetRateLimit()
    await owner.post('/auth/register').send({ name: 'owner', email: ownerEmail, password })
    await owner.post('/auth/login').send({ email: ownerEmail, password })

    await resetRateLimit()
    const a = await admin.post('/auth/register').send({ name: 'admin', email: adminEmail, password })
    adminId = a.body.user.id
    await admin.post('/auth/login').send({ email: adminEmail, password })

    await resetRateLimit()
    const m = await member.post('/auth/register').send({ name: 'member', email: memberEmail, password })
    memberId = m.body.user.id
    await member.post('/auth/login').send({ email: memberEmail, password })

    await resetRateLimit()
    await outsider.post('/auth/register').send({ name: 'outsider', email: outsiderEmail, password })
    await outsider.post('/auth/login').send({ email: outsiderEmail, password })
})

// Clean up: delete the orgs this run made and the four users. Membership rows
// are removed automatically by ON DELETE CASCADE.
afterAll(async () => {
    await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
    await db.delete(users).where(inArray(users.email, [ownerEmail, adminEmail, memberEmail, outsiderEmail]))
})

describe('organization access and permissions', () => {
    it('lets a user create an organization and become its owner', async () => {
        const res = await owner.post('/orgs').send({ name: 'Acme', slug: `acme-${stamp}` })

        expect(res.status).toBe(201)
        const rows = await db.select().from(memberships)
            .where(eq(memberships.organizationId, res.body.organization.id))
        expect(rows[0].userRole).toBe('owner')
    })

    it('lets a member read the org but hides it from a non-member', async () => {
        const created = await owner.post('/orgs').send({ name: 'Read', slug: `read-${stamp}` })
        const orgId = created.body.organization.id
        await db.insert(memberships).values({ userId: memberId, organizationId: orgId, userRole: 'member' })

        expect((await member.get(`/orgs/${orgId}`)).status).toBe(200)
        expect((await outsider.get(`/orgs/${orgId}`)).status).toBe(404)
    })

    it('lets an admin update the org but blocks a plain member', async () => {
        const created = await owner.post('/orgs').send({ name: 'Edit', slug: `edit-${stamp}` })
        const orgId = created.body.organization.id
        await db.insert(memberships).values([
            { userId: adminId, organizationId: orgId, userRole: 'admin' },
            { userId: memberId, organizationId: orgId, userRole: 'member' },
        ])

        expect((await admin.patch(`/orgs/${orgId}`).send({ name: 'Edited' })).status).toBe(200)
        expect((await member.patch(`/orgs/${orgId}`).send({ name: 'Nope' })).status).toBe(403)
    })

    it('lets only the owner delete the org', async () => {
        const created = await owner.post('/orgs').send({ name: 'Remove', slug: `remove-${stamp}` })
        const orgId = created.body.organization.id
        await db.insert(memberships).values({ userId: adminId, organizationId: orgId, userRole: 'admin' })

        expect((await admin.delete(`/orgs/${orgId}`)).status).toBe(403)
        expect((await owner.delete(`/orgs/${orgId}`)).status).toBe(200)
    })
})
