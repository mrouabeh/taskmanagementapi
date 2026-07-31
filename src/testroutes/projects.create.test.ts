import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { like, inArray } from 'drizzle-orm'
import app from '../app'
import { db } from '../db'
import { users, organizations } from '../db/schema'
import { redisClient } from '../redis'

const stamp = Date.now()
const password = 'Password123!'
const email = `pp-${stamp}@example.com`
const owner = request.agent(app)

let orgId: number, teamA: number, teamB: number

beforeAll(async () => {
  const keys = await redisClient.keys('rate:*')
  if (keys.length) await redisClient.del(keys)
  await owner.post('/auth/register').send({ name: 'o', email, password })
  await owner.post('/auth/login').send({ email, password })
  orgId = (await owner.post('/orgs').send({ name: 'O', slug: `pp-${stamp}` })).body.organization.id
  teamA = (await owner.post(`/orgs/${orgId}/teams`).send({ name: 'TA' })).body.team.id
  teamB = (await owner.post(`/orgs/${orgId}/teams`).send({ name: 'TB' })).body.team.id
})

afterAll(async () => {
  await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
  await db.delete(users).where(inArray(users.email, [email]))
})

const url = (t: number) => `/orgs/${orgId}/teams/${t}/projects`

describe('POST /projects', () => {
  it('creates and honours an explicit status', async () => {
    const r = await owner
      .post(url(teamA))
      .send({ name: 'Alpha', status: 'active', description: 'hi' })
    expect(r.status).toBe(201)
    expect(r.body.project).toMatchObject({
      name: 'Alpha',
      status: 'active',
      description: 'hi',
      teamId: teamA,
    })
  })

  it('defaults status to planning and description to null', async () => {
    const r = await owner.post(url(teamA)).send({ name: 'Beta' })
    expect(r.status).toBe(201)
    expect(r.body.project.status).toBe('planning')
    expect(r.body.project.description).toBeNull()
  })

  it('409s a duplicate name in the same team', async () => {
    expect((await owner.post(url(teamA)).send({ name: 'Alpha' })).status).toBe(409)
  })

  // Proves UNIQUE (team_id, name) is scoped per team, not global.
  it('allows the same name in a different team', async () => {
    expect((await owner.post(url(teamB)).send({ name: 'Alpha' })).status).toBe(201)
  })

  it('400s an empty name and a bogus status', async () => {
    expect((await owner.post(url(teamA)).send({ name: '' })).status).toBe(400)
    expect((await owner.post(url(teamA)).send({ name: 'X', status: 'nope' })).status).toBe(400)
  })

  it('404s a team in another org', async () => {
    const other = (await owner.post('/orgs').send({ name: 'Z', slug: `zz-${stamp}` })).body
      .organization.id
    expect(
      (await owner.post(`/orgs/${other}/teams/${teamA}/projects`).send({ name: 'C' })).status,
    ).toBe(404)
  })

  it('lets teams DELETE refuse once a project exists', async () => {
    expect((await owner.delete(`/orgs/${orgId}/teams/${teamA}`)).status).toBe(409)
  })
})
