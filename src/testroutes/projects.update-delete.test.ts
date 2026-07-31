import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { eq, like, inArray } from 'drizzle-orm'
import app from '../app'
import { db } from '../db'
import { users, organizations, memberships, projects } from '../db/schema'
import { redisClient } from '../redis'

const stamp = Date.now()
const password = 'Password123!'
const ownerEmail = `pd-owner-${stamp}@example.com`
const memberEmail = `pd-member-${stamp}@example.com`

const owner = request.agent(app)
const member = request.agent(app)
let memberId: number
let orgId: number, teamA: number, teamB: number

beforeAll(async () => {
  const keys = await redisClient.keys('rate:*')
  if (keys.length) await redisClient.del(keys)
  await owner.post('/auth/register').send({ name: 'o', email: ownerEmail, password })
  await owner.post('/auth/login').send({ email: ownerEmail, password })
  const m = await member.post('/auth/register').send({ name: 'm', email: memberEmail, password })
  memberId = m.body.user.id
  await member.post('/auth/login').send({ email: memberEmail, password })

  orgId = (await owner.post('/orgs').send({ name: 'O', slug: `pd-${stamp}` })).body.organization.id
  await db
    .insert(memberships)
    .values({ userId: memberId, organizationId: orgId, userRole: 'member' })
  teamA = (await owner.post(`/orgs/${orgId}/teams`).send({ name: 'TA' })).body.team.id
  teamB = (await owner.post(`/orgs/${orgId}/teams`).send({ name: 'TB' })).body.team.id
})

afterAll(async () => {
  await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
  await db.delete(users).where(inArray(users.email, [ownerEmail, memberEmail]))
})

const url = (t: number) => `/orgs/${orgId}/teams/${t}/projects`
const make = async (t: number, name: string) =>
  (await owner.post(url(t)).send({ name })).body.project

describe('PATCH', () => {
  it('renames and moves updatedAt', async () => {
    const p = await make(teamA, `ren-${stamp}`)
    await new Promise((r) => setTimeout(r, 1100)) // timestamps have second resolution
    const r = await owner.patch(`${url(teamA)}/${p.id}`).send({ name: `ren2-${stamp}` })

    expect(r.status).toBe(200)
    expect(r.body.project.name).toBe(`ren2-${stamp}`)
    expect(new Date(r.body.project.updatedAt).getTime()).toBeGreaterThan(
      new Date(p.updatedAt).getTime(),
    )
  })

  it('sets archivedAt when archiving and clears it when unarchiving', async () => {
    const p = await make(teamA, `arc-${stamp}`)
    expect(p.archivedAt).toBeNull()

    const a = await owner.patch(`${url(teamA)}/${p.id}`).send({ status: 'archived' })
    expect(a.body.project.status).toBe('archived')
    expect(a.body.project.archivedAt).not.toBeNull()

    const b = await owner.patch(`${url(teamA)}/${p.id}`).send({ status: 'active' })
    expect(b.body.project.status).toBe('active')
    expect(b.body.project.archivedAt).toBeNull()
  })

  // The undefined guard: a rename must not disturb an archived project's timestamp.
  it('leaves archivedAt untouched when status is not sent', async () => {
    const p = await make(teamA, `keep-${stamp}`)
    const a = await owner.patch(`${url(teamA)}/${p.id}`).send({ status: 'archived' })
    const stampedAt = a.body.project.archivedAt

    const r = await owner.patch(`${url(teamA)}/${p.id}`).send({ name: `keep2-${stamp}` })
    expect(r.body.project.archivedAt).toBe(stampedAt)
    expect(r.body.project.status).toBe('archived')
  })

  it('409s renaming onto a sibling name, 400s an empty body', async () => {
    await make(teamA, `taken-${stamp}`)
    const p = await make(teamA, `other-${stamp}`)

    expect(
      (await owner.patch(`${url(teamA)}/${p.id}`).send({ name: `taken-${stamp}` })).status,
    ).toBe(409)
    expect((await owner.patch(`${url(teamA)}/${p.id}`).send({})).status).toBe(400)
  })

  it('404s a project from another team', async () => {
    const foreign = await make(teamB, `foreign-${stamp}`)
    const r = await owner.patch(`${url(teamA)}/${foreign.id}`).send({ name: 'X' })
    expect(r.status).toBe(404)

    const [row] = await db.select().from(projects).where(eq(projects.id, foreign.id))
    expect(row.name).toBe(`foreign-${stamp}`) // untouched
  })
})

describe('DELETE', () => {
  it('deletes and returns the row', async () => {
    const p = await make(teamA, `del-${stamp}`)
    const r = await owner.delete(`${url(teamA)}/${p.id}`)

    expect(r.status).toBe(200)
    expect(r.body.project.id).toBe(p.id)
    expect(await db.select().from(projects).where(eq(projects.id, p.id))).toHaveLength(0)
  })

  it('403s a plain member, who may still PATCH', async () => {
    const p = await make(teamA, `role-${stamp}`)
    expect((await member.delete(`${url(teamA)}/${p.id}`)).status).toBe(403)
    expect((await member.patch(`${url(teamA)}/${p.id}`).send({ status: 'on_hold' })).status).toBe(
      200,
    )
  })

  it('404s a project from another team', async () => {
    const foreign = await make(teamB, `fdel-${stamp}`)
    expect((await owner.delete(`${url(teamA)}/${foreign.id}`)).status).toBe(404)
    expect(await db.select().from(projects).where(eq(projects.id, foreign.id))).toHaveLength(1)
  })
})
