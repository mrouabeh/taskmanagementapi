import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, like, inArray } from 'drizzle-orm'
import request from 'supertest'
import app from '../app'
import { db } from '../db'
import { users, organizations, memberships, comments } from '../db/schema'
import { redisClient } from '../redis'

const stamp = Date.now()
const password = 'Password123!'
const ownerEmail = `cm-owner-${stamp}@example.com`
const memberEmail = `cm-member-${stamp}@example.com`
const otherEmail = `cm-other-${stamp}@example.com`

const owner = request.agent(app) // admin-rank (org owner)
const member = request.agent(app)
const other = request.agent(app)

let memberId: number, otherId: number
let orgId: number, teamId: number, projectId: number, taskA: number, taskB: number

beforeAll(async () => {
  // /auth/* allows 5 requests per 30s per IP and supertest hits from one IP.
  const reset = async () => {
    const keys = await redisClient.keys('rate:*')
    if (keys.length) await redisClient.del(keys)
  }

  await reset()
  await owner.post('/auth/register').send({ name: 'o', email: ownerEmail, password })
  await owner.post('/auth/login').send({ email: ownerEmail, password })

  await reset()
  const m = await member.post('/auth/register').send({ name: 'm', email: memberEmail, password })
  memberId = m.body.user.id
  await member.post('/auth/login').send({ email: memberEmail, password })

  await reset()
  const o = await other.post('/auth/register').send({ name: 'x', email: otherEmail, password })
  otherId = o.body.user.id
  await other.post('/auth/login').send({ email: otherEmail, password })

  orgId = (await owner.post('/orgs').send({ name: 'O', slug: `cm-${stamp}` })).body.organization.id
  await db.insert(memberships).values([
    { userId: memberId, organizationId: orgId, userRole: 'member' },
    { userId: otherId, organizationId: orgId, userRole: 'member' },
  ])
  teamId = (await owner.post(`/orgs/${orgId}/teams`).send({ name: 'T' })).body.team.id
  projectId = (await owner.post(`/orgs/${orgId}/teams/${teamId}/projects`).send({ name: 'P' })).body
    .project.id

  const tasksUrl = `/orgs/${orgId}/teams/${teamId}/projects/${projectId}/tasks`
  taskA = (await owner.post(tasksUrl).send({ title: 'A' })).body.task.id
  taskB = (await owner.post(tasksUrl).send({ title: 'B' })).body.task.id
})

afterAll(async () => {
  await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
  await db.delete(users).where(inArray(users.email, [ownerEmail, memberEmail, otherEmail]))
})

const url = (t: number) =>
  `/orgs/${orgId}/teams/${teamId}/projects/${projectId}/tasks/${t}/comments`

describe('comments', () => {
  it('posts through six mergeParams levels, stamping the author', async () => {
    const r = await member.post(url(taskA)).send({ body: 'First thought' })
    expect(r.status).toBe(201)
    expect(r.body.comment).toMatchObject({ body: 'First thought', taskId: taskA, userId: memberId })
  })

  it('lists a thread in creation order', async () => {
    const t = taskB
    await member.post(url(t)).send({ body: 'one' })
    await new Promise((r) => setTimeout(r, 20))
    await other.post(url(t)).send({ body: 'two' })
    await new Promise((r) => setTimeout(r, 20))
    await member.post(url(t)).send({ body: 'three' })

    const r = await owner.get(url(t))
    expect(r.status).toBe(200)
    expect(r.body.comments.map((c: any) => c.body)).toEqual(['one', 'two', 'three'])
  })

  it('lets the author edit and delete their own comment', async () => {
    const c = (await member.post(url(taskA)).send({ body: 'mine' })).body.comment

    const patched = await member.patch(`${url(taskA)}/${c.id}`).send({ body: 'mine, edited' })
    expect(patched.status).toBe(200)
    expect(patched.body.comment.body).toBe('mine, edited')

    expect((await member.delete(`${url(taskA)}/${c.id}`)).status).toBe(200)
  })

  it('403s another member editing or deleting it', async () => {
    const c = (await member.post(url(taskA)).send({ body: 'not yours' })).body.comment

    expect((await other.patch(`${url(taskA)}/${c.id}`).send({ body: 'hijacked' })).status).toBe(403)
    expect((await other.delete(`${url(taskA)}/${c.id}`)).status).toBe(403)

    const [row] = await db.select().from(comments).where(eq(comments.id, c.id))
    expect(row.body).toBe('not yours') // untouched
  })

  it("lets an admin edit and delete somebody else's comment", async () => {
    const c = (await member.post(url(taskA)).send({ body: 'moderate me' })).body.comment

    expect((await owner.patch(`${url(taskA)}/${c.id}`).send({ body: 'moderated' })).status).toBe(
      200,
    )
    expect((await owner.delete(`${url(taskA)}/${c.id}`)).status).toBe(200)
  })

  it('moves updatedAt on PATCH', async () => {
    const c = (await member.post(url(taskA)).send({ body: 'before' })).body.comment
    await new Promise((r) => setTimeout(r, 1100))
    const r = await member.patch(`${url(taskA)}/${c.id}`).send({ body: 'after' })
    expect(new Date(r.body.comment.updatedAt).getTime()).toBeGreaterThan(
      new Date(c.updatedAt).getTime(),
    )
  })

  // 404 before 403: the status code must not reveal that the id exists.
  it('404s a comment id from another task, even for its own author', async () => {
    const c = (await member.post(url(taskB)).send({ body: 'over here' })).body.comment

    expect((await member.get(url(taskA))).status).toBe(200)
    expect((await member.patch(`${url(taskA)}/${c.id}`).send({ body: 'x' })).status).toBe(404)
    expect((await member.delete(`${url(taskA)}/${c.id}`)).status).toBe(404)

    const [row] = await db.select().from(comments).where(eq(comments.id, c.id))
    expect(row.body).toBe('over here')
  })

  it('400s an empty body, whitespace-only body and malformed commentId', async () => {
    expect((await member.post(url(taskA)).send({ body: '' })).status).toBe(400)
    expect((await member.post(url(taskA)).send({ body: '   ' })).status).toBe(400)
    expect((await member.post(url(taskA)).send({})).status).toBe(400)
    expect((await member.patch(`${url(taskA)}/12abc`).send({ body: 'x' })).status).toBe(400)
  })

  it('deletes a task and takes its comments with it', async () => {
    const tasksUrl = `/orgs/${orgId}/teams/${teamId}/projects/${projectId}/tasks`
    const t = (await owner.post(tasksUrl).send({ title: `doomed-${stamp}` })).body.task
    const c = (await member.post(url(t.id)).send({ body: 'goes with the task' })).body.comment

    expect((await owner.delete(`${tasksUrl}/${t.id}`)).status).toBe(200)
    expect(await db.select().from(comments).where(eq(comments.id, c.id))).toHaveLength(0)
  })
})
