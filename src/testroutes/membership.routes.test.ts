import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { and, eq, like, inArray } from 'drizzle-orm'
import app from '../app'
import { db } from '../db'
import { users, organizations, memberships } from '../db/schema'
import { redisClient } from '../redis'

// Unique per run so repeated runs don't collide on the slug/email unique indexes.
const stamp = Date.now()
const password = 'Password123!'

const ownerEmail = `mem-owner-${stamp}@example.com`
const adminEmail = `mem-admin-${stamp}@example.com`
const memberEmail = `mem-member-${stamp}@example.com`
const guestEmail = `mem-guest-${stamp}@example.com`
const outsiderEmail = `mem-outsider-${stamp}@example.com`

const owner = request.agent(app)
const admin = request.agent(app)
const member = request.agent(app)
const guest = request.agent(app)
const outsider = request.agent(app)

let adminId: number
let memberId: number
let guestId: number
let outsiderId: number
let orgId: number

// /auth/* is rate limited to 5 requests per window per IP; clear the counters
// between each register+login pair so the sign-ups stay under it.
async function resetRateLimit() {
    const keys = await redisClient.keys('rate:*')
    if (keys.length) await redisClient.del(keys)
}

// Each mutation test gets its own org so deletes in one can't disturb another.
// The owner is created implicitly by POST /orgs.
async function freshOrg(name: string) {
    const created = await owner.post('/orgs').send({ name, slug: `${name}-${stamp}` })
    return created.body.organization.id as number
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
    const g = await guest.post('/auth/register').send({ name: 'guest', email: guestEmail, password })
    guestId = g.body.user.id
    await guest.post('/auth/login').send({ email: guestEmail, password })

    await resetRateLimit()
    const o = await outsider.post('/auth/register').send({ name: 'outsider', email: outsiderEmail, password })
    outsiderId = o.body.user.id
    await outsider.post('/auth/login').send({ email: outsiderEmail, password })

    // One org holding all three roles: owner (auto), member, guest.
    orgId = await freshOrg('roster')
    await db.insert(memberships).values([
        { userId: memberId, organizationId: orgId, userRole: 'member' },
        { userId: guestId, organizationId: orgId, userRole: 'guest' },
    ])
})

// Membership rows go with the org via ON DELETE CASCADE.
afterAll(async () => {
    await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
    await db.delete(users).where(inArray(users.email, [
        ownerEmail, adminEmail, memberEmail, guestEmail, outsiderEmail,
    ]))
})

describe('GET /orgs/:orgId/members', () => {
    it('returns the full roster to a member', async () => {
        const res = await member.get(`/orgs/${orgId}/members`)

        // A 404 here means `mergeParams` is not reaching loadMembership.
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.members).toHaveLength(3)

        const byEmail = Object.fromEntries(res.body.members.map((m: any) => [m.email, m.role]))
        expect(byEmail[ownerEmail]).toBe('owner')
        expect(byEmail[memberEmail]).toBe('member')
        expect(byEmail[guestEmail]).toBe('guest')
    })

    it('exposes the join fields the client needs', async () => {
        const res = await owner.get(`/orgs/${orgId}/members`)
        const self = res.body.members.find((m: any) => m.email === ownerEmail)

        expect(self).toMatchObject({ role: 'owner', name: 'owner' })
        expect(typeof self.id).toBe('number')      // membership id, for DELETE
        expect(typeof self.userId).toBe('number')
    })

    it('hides the roster from a non-member', async () => {
        expect((await outsider.get(`/orgs/${orgId}/members`)).status).toBe(404)
    })

    it('blocks a guest, who is below the member rank', async () => {
        expect((await guest.get(`/orgs/${orgId}/members`)).status).toBe(403)
    })

    it('404s on a malformed orgId', async () => {
        expect((await member.get('/orgs/not-a-number/members')).status).toBe(404)
    })
})

describe('POST /orgs/:orgId/members', () => {
    it('lets an admin add a user by email', async () => {
        const id = await freshOrg('add')
        await db.insert(memberships).values({ userId: adminId, organizationId: id, userRole: 'admin' })

        const res = await admin.post(`/orgs/${id}/members`).send({ email: outsiderEmail, role: 'member' })

        expect(res.status).toBe(201)
        expect(res.body.member).toMatchObject({ userId: outsiderId, organizationId: id, userRole: 'member' })
    })

    it('defaults the role to member when the body omits it', async () => {
        const id = await freshOrg('default-role')

        const res = await owner.post(`/orgs/${id}/members`).send({ email: outsiderEmail })

        expect(res.status).toBe(201)
        expect(res.body.member.userRole).toBe('member')
    })

    it('409s when the user is already a member', async () => {
        const id = await freshOrg('dupe')
        await owner.post(`/orgs/${id}/members`).send({ email: outsiderEmail })

        const res = await owner.post(`/orgs/${id}/members`).send({ email: outsiderEmail })

        expect(res.status).toBe(409)
    })

    it('404s on an email that belongs to no user', async () => {
        const id = await freshOrg('ghost')

        const res = await owner.post(`/orgs/${id}/members`).send({ email: `nobody-${stamp}@example.com` })

        expect(res.status).toBe(404)
    })

    it('400s on a malformed email', async () => {
        const id = await freshOrg('bad-email')

        expect((await owner.post(`/orgs/${id}/members`).send({ email: 'not-an-email' })).status).toBe(400)
    })

    // The ceiling: this is the privilege-escalation guard.
    it('stops an admin from minting an owner or a peer admin', async () => {
        const id = await freshOrg('ceiling-add')
        await db.insert(memberships).values({ userId: adminId, organizationId: id, userRole: 'admin' })

        expect((await admin.post(`/orgs/${id}/members`).send({ email: outsiderEmail, role: 'owner' })).status).toBe(403)
        expect((await admin.post(`/orgs/${id}/members`).send({ email: outsiderEmail, role: 'admin' })).status).toBe(403)

        // …and nothing was written on the way to that 403.
        const rows = await db.select().from(memberships)
            .where(and(eq(memberships.organizationId, id), eq(memberships.userId, outsiderId)))
        expect(rows).toHaveLength(0)
    })

    it('lets an owner grant admin', async () => {
        const id = await freshOrg('owner-grants')

        const res = await owner.post(`/orgs/${id}/members`).send({ email: outsiderEmail, role: 'admin' })

        expect(res.status).toBe(201)
        expect(res.body.member.userRole).toBe('admin')
    })

    it('blocks a plain member from adding anyone', async () => {
        const id = await freshOrg('member-add')
        await db.insert(memberships).values({ userId: memberId, organizationId: id, userRole: 'member' })

        expect((await member.post(`/orgs/${id}/members`).send({ email: outsiderEmail })).status).toBe(403)
    })
})

describe('DELETE /orgs/:orgId/members/:membershipId', () => {
    it('lets an admin remove a plain member', async () => {
        const id = await freshOrg('remove')
        await db.insert(memberships).values({ userId: adminId, organizationId: id, userRole: 'admin' })
        const [target] = await db.insert(memberships)
            .values({ userId: memberId, organizationId: id, userRole: 'member' }).returning()

        const res = await admin.delete(`/orgs/${id}/members/${target.id}`)

        expect(res.status).toBe(200)
        expect(res.body.membership.id).toBe(target.id)

        const rows = await db.select().from(memberships).where(eq(memberships.id, target.id))
        expect(rows).toHaveLength(0)
    })

    // The ceiling again, on the removal side.
    it('stops an admin from removing an owner', async () => {
        const id = await freshOrg('ceiling-remove')
        await db.insert(memberships).values({ userId: adminId, organizationId: id, userRole: 'admin' })
        const [ownerRow] = await db.select().from(memberships)
            .where(and(eq(memberships.organizationId, id), eq(memberships.userRole, 'owner')))

        expect((await admin.delete(`/orgs/${id}/members/${ownerRow.id}`)).status).toBe(403)

        const rows = await db.select().from(memberships).where(eq(memberships.id, ownerRow.id))
        expect(rows).toHaveLength(1)   // still there
    })

    // The guard that keeps an org administrable.
    it('refuses to remove the last owner', async () => {
        const id = await freshOrg('last-owner')
        const [ownerRow] = await db.select().from(memberships)
            .where(and(eq(memberships.organizationId, id), eq(memberships.userRole, 'owner')))

        const res = await owner.delete(`/orgs/${id}/members/${ownerRow.id}`)

        expect(res.status).toBe(409)

        const rows = await db.select().from(memberships).where(eq(memberships.id, ownerRow.id))
        expect(rows).toHaveLength(1)
    })

    it('allows removing an owner once a second owner exists', async () => {
        const id = await freshOrg('two-owners')
        const [extra] = await db.insert(memberships)
            .values({ userId: adminId, organizationId: id, userRole: 'owner' }).returning()

        expect((await owner.delete(`/orgs/${id}/members/${extra.id}`)).status).toBe(200)
    })

    // Org scoping: the id is real, but it belongs to somebody else's org.
    it('404s on a membership id from another organization', async () => {
        const mine = await freshOrg('scope-mine')
        const other = await freshOrg('scope-other')
        await db.insert(memberships).values({ userId: adminId, organizationId: mine, userRole: 'admin' })
        const [foreign] = await db.insert(memberships)
            .values({ userId: memberId, organizationId: other, userRole: 'member' }).returning()

        expect((await admin.delete(`/orgs/${mine}/members/${foreign.id}`)).status).toBe(404)

        const rows = await db.select().from(memberships).where(eq(memberships.id, foreign.id))
        expect(rows).toHaveLength(1)   // untouched
    })

    it('400s on a malformed membershipId', async () => {
        const id = await freshOrg('bad-id')

        expect((await owner.delete(`/orgs/${id}/members/12abc`)).status).toBe(400)
    })
})
