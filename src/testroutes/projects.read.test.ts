import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { like, inArray } from 'drizzle-orm'
import app from '../app'
import { db } from '../db'
import { users, organizations, projects } from '../db/schema'
import { redisClient } from '../redis'

const stamp = Date.now()
const password = 'Password123!'
const ownerEmail = `pj-owner-${stamp}@example.com`
const outsiderEmail = `pj-out-${stamp}@example.com`

const owner = request.agent(app)
const outsider = request.agent(app)

let orgA: number, orgB: number
let teamA: number, teamA2: number, teamB: number
let p1: number, pOther: number

beforeAll(async () => {
  const keys = await redisClient.keys('rate:*')
  if (keys.length) await redisClient.del(keys)
  await owner.post('/auth/register').send({ name: 'o', email: ownerEmail, password })
  await owner.post('/auth/login').send({ email: ownerEmail, password })
  await outsider.post('/auth/register').send({ name: 'x', email: outsiderEmail, password })
  await outsider.post('/auth/login').send({ email: outsiderEmail, password })

  orgA = (await owner.post('/orgs').send({ name: 'A', slug: `pa-${stamp}` })).body.organization.id
  orgB = (await owner.post('/orgs').send({ name: 'B', slug: `pb-${stamp}` })).body.organization.id
  teamA = (await owner.post(`/orgs/${orgA}/teams`).send({ name: 'TA' })).body.team.id
  teamA2 = (await owner.post(`/orgs/${orgA}/teams`).send({ name: 'TA2' })).body.team.id
  teamB = (await owner.post(`/orgs/${orgB}/teams`).send({ name: 'TB' })).body.team.id

  // No POST route yet, so seed directly.
  p1 = (await db.insert(projects).values({ teamId: teamA, name: 'P1' }).returning())[0].id
  pOther = (await db.insert(projects).values({ teamId: teamA2, name: 'POther' }).returning())[0].id
})

afterAll(async () => {
  await db.delete(organizations).where(like(organizations.slug, `%-${stamp}`))
  await db.delete(users).where(inArray(users.email, [ownerEmail, outsiderEmail]))
})

describe('projects GET routes', () => {
  it("lists only the addressed team's projects", async () => {
    const r = await owner.get(`/orgs/${orgA}/teams/${teamA}/projects`)
    expect(r.status).toBe(200)
    expect(r.body.projects).toHaveLength(1)
    expect(r.body.projects[0]).toMatchObject({ name: 'P1', status: 'planning' })
  })

  it('returns an empty array for a team with no projects', async () => {
    const r = await owner.get(`/orgs/${orgB}/teams/${teamB}/projects`)
    expect(r.status).toBe(200)
    expect(r.body.projects).toEqual([])
  })

  it('reads one project', async () => {
    const r = await owner.get(`/orgs/${orgA}/teams/${teamA}/projects/${p1}`)
    expect(r.status).toBe(200)
    expect(r.body.project.name).toBe('P1')
    expect(r.body.project).toHaveProperty('archivedAt')
  })

  it('404s a project id from another team', async () => {
    const r = await owner.get(`/orgs/${orgA}/teams/${teamA}/projects/${pOther}`)
    expect(r.status).toBe(404)
  })

  it('404s a team from another org (loadTeam)', async () => {
    const r = await owner.get(`/orgs/${orgA}/teams/${teamB}/projects`)
    expect(r.status).toBe(404)
  })

  it('404s a non-member (loadMembership)', async () => {
    const r = await outsider.get(`/orgs/${orgA}/teams/${teamA}/projects`)
    expect(r.status).toBe(404)
  })

  it('400s a malformed projectId, 404s a malformed teamId', async () => {
    expect((await owner.get(`/orgs/${orgA}/teams/${teamA}/projects/12abc`)).status).toBe(400)
    expect((await owner.get(`/orgs/${orgA}/teams/99abc/projects`)).status).toBe(404)
  })
})
