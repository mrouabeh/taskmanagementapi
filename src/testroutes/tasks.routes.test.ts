import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, like, inArray } from 'drizzle-orm'
import request from 'supertest'
import app from '../app'
import { db } from '../db'
import { users, organizations, memberships, tasks } from '../db/schema'
import { redisClient } from '../redis'

const stamp = Date.now()
const password = 'Password123!'
const ownerEmail = `tk-owner-${stamp}@example.com`
const memberEmail = `tk-member-${stamp}@example.com`
const outsiderEmail = `tk-out-${stamp}@example.com`

const owner = request.agent(app)
const member = request.agent(app)
const outsider = request.agent(app)

let ownerId: number, memberId: number, outsiderId: number
let orgId: number, teamId: number, projectA: number, projectB: number

beforeAll(async () => {
    // /auth/* allows 5 requests per 30s per IP and supertest always hits from
    // one IP — clear the counters between each register+login pair.
    const reset = async () => {
      const keys = await redisClient.keys('rate:*')
      if (keys.length) await redisClient.del(keys)
    }

    await reset()
    const o = await owner.post('/auth/register').send({ name: 'o', email: ownerEmail, password })
    ownerId = o.body.user.id
    await owner.post('/auth/login').send({ email: ownerEmail, password })

    await reset()
    const m = await member.post('/auth/register').send({ name: 'm', email: memberEmail, password })
    memberId = m.body.user.id
    await member.post('/auth/login').send({ email: memberEmail, password })

    await reset()
    const x = await outsider.post('/auth/register').send({ name: 'x', email: outsiderEmail, password })
    outsiderId = x.body.user.id
    await outsider.post('/auth/login').send({ email: outsiderEmail, password })

    orgId = (await owner.post('/orgs').send({ name: 'O', slug: `tk-${stamp}` })).body.organization.id
    await db.insert(memberships).values({ userId: memberId, organizationId: orgId, userRole: 'member' })
    teamId = (await owner.post(`/orgs/${orgId}/teams`).send({ name: 'T' })).body.team.id
    projectA = (await owner.post(`/orgs/${orgId}/teams/${teamId}/projects`).send({ name: 'PA' })).body.project.id
    projectB = (await owner.post(`/orgs/${orgId}/teams/${teamId}/projects`).send({ name: 'PB' })).body.project.id
})

afterAll(async () => {
    await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
    await db.delete(users).where(inArray(users.email, [ownerEmail, memberEmail, outsiderEmail]))
})

const url = (p: number) => `/orgs/${orgId}/teams/${teamId}/projects/${p}/tasks`

describe('tasks', () => {
    it('creates through four levels of mergeParams, stamping createdById', async () => {
        const r = await owner.post(url(projectA)).send({ title: 'Fix login' })
        expect(r.status).toBe(201)
        expect(r.body.task).toMatchObject({
            title: 'Fix login', status: 'todo', priority: 'medium',
            projectId: projectA, createdById: ownerId, assigneeId: null,
        })
    })

    it('lists only this project, empty project returns []', async () => {
        const a = await owner.get(url(projectA))
        expect(a.status).toBe(200)
        expect(a.body.tasks.length).toBeGreaterThan(0)

        const b = await owner.get(url(projectB))
        expect(b.body.tasks).toEqual([])
    })

    it('rejects an assignee outside the organization', async () => {
        const r = await owner.post(url(projectA)).send({ title: 'X', assigneeId: outsiderId })
        expect(r.status).toBe(400)

        const ok = await owner.post(url(projectA)).send({ title: 'Y', assigneeId: memberId })
        expect(ok.status).toBe(201)
        expect(ok.body.task.assigneeId).toBe(memberId)
    })

    it('syncs completedAt with status, and a rename leaves it alone', async () => {
        const t = (await owner.post(url(projectA)).send({ title: `done-${stamp}` })).body.task
        expect(t.completedAt).toBeNull()

        const done = await owner.patch(`${url(projectA)}/${t.id}`).send({ status: 'done' })
        expect(done.body.task.completedAt).not.toBeNull()
        const stampedAt = done.body.task.completedAt

        const renamed = await owner.patch(`${url(projectA)}/${t.id}`).send({ title: `renamed-${stamp}` })
        expect(renamed.body.task.completedAt).toBe(stampedAt)   // undefined guard

        const reopened = await owner.patch(`${url(projectA)}/${t.id}`).send({ status: 'todo' })
        expect(reopened.body.task.completedAt).toBeNull()
    })

    it('moves updatedAt on PATCH', async () => {
        const t = (await owner.post(url(projectA)).send({ title: `upd-${stamp}` })).body.task
        await new Promise(r => setTimeout(r, 1100))
        const r = await owner.patch(`${url(projectA)}/${t.id}`).send({ priority: 'high' })
        expect(new Date(r.body.task.updatedAt).getTime())
            .toBeGreaterThan(new Date(t.updatedAt).getTime())
    })

    it('unassigns with assigneeId: null', async () => {
        const t = (await owner.post(url(projectA)).send({ title: `un-${stamp}`, assigneeId: memberId })).body.task
        const r = await owner.patch(`${url(projectA)}/${t.id}`).send({ assigneeId: null })
        expect(r.body.task.assigneeId).toBeNull()
    })

    it('404s a task id from another project on GET, PATCH and DELETE', async () => {
        const foreign = (await owner.post(url(projectB)).send({ title: `f-${stamp}` })).body.task

        expect((await owner.get(`${url(projectA)}/${foreign.id}`)).status).toBe(404)
        expect((await owner.patch(`${url(projectA)}/${foreign.id}`).send({ title: 'z' })).status).toBe(404)
        expect((await owner.delete(`${url(projectA)}/${foreign.id}`)).status).toBe(404)

        const [row] = await db.select().from(tasks).where(eq(tasks.id, foreign.id))
        expect(row.title).toBe(`f-${stamp}`)
    })

    it('deletes as admin, refuses as member', async () => {
        const t = (await owner.post(url(projectA)).send({ title: `del-${stamp}` })).body.task
        expect((await member.delete(`${url(projectA)}/${t.id}`)).status).toBe(403)
        expect((await owner.delete(`${url(projectA)}/${t.id}`)).status).toBe(200)
        expect(await db.select().from(tasks).where(eq(tasks.id, t.id))).toHaveLength(0)
    })

    it('400s an empty title, empty PATCH body and malformed taskId', async () => {
        expect((await owner.post(url(projectA)).send({ title: '' })).status).toBe(400)
        const t = (await owner.post(url(projectA)).send({ title: `v-${stamp}` })).body.task
        expect((await owner.patch(`${url(projectA)}/${t.id}`).send({})).status).toBe(400)
        expect((await owner.get(`${url(projectA)}/12abc`)).status).toBe(400)
    })

    it('404s a project from another team and a non-member', async () => {
        expect((await outsider.get(url(projectA))).status).toBe(404)
    })
})
