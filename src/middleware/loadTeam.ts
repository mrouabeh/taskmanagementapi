import { RequestHandler } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { teams } from '../db/schema'
import { NotFoundError } from '../lib/errors'

export const loadTeam: RequestHandler = async (req, res, next) => {
  const teamId = Number(req.params.teamId)
  if (!Number.isSafeInteger(teamId) || teamId <= 0) {
    throw new NotFoundError('Team not found')
  }
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organizationId, req.membership!.organizationId)))
    .limit(1)
  if (!rows[0]) throw new NotFoundError('Team not found')
  req.team = { id: rows[0].id }
  next()
}
