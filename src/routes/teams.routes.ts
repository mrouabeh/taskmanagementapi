import { Router } from 'express'
import { db } from '../db'
import { teams, projects } from '../db/schema'
import { auth } from '../middleware/auth'
import { loadMembership, requireRole } from '../middleware/requireRole'
import { and, eq } from 'drizzle-orm'
import { ValidationError, ConflictError, NotFoundError } from '../lib/errors'
import { createTeamSchema, teamIdParamSchema, updateTeamSchema } from '../validation/teams.schema'
import { loadTeam } from '../middleware/loadTeam'
import projectRouter from './projects.routes'

const teamRouter = Router({ mergeParams: true })

// Registered before every handler: Express applies middleware in registration
// order, so a `.use` placed below the routes would never run for them and
// `req.membership` would be undefined.
teamRouter.use(auth, loadMembership)

teamRouter.get('/', requireRole('member'), async (req, res) => {
  const rows = await db.select({
        id: teams.id,
        name: teams.name,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .where(eq(teams.organizationId, req.membership!.organizationId))

  res.status(200).json({ success: true, teams: rows })
})

teamRouter.post('/', requireRole('admin'), async (req, res) => {
  const result = createTeamSchema.safeParse(req.body)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { name } = result.data
  try {
    const insertTeam = await db.insert(teams)
      .values({ name, organizationId: req.membership!.organizationId })
    .returning()
    res.status(201).json({ success: true, team: insertTeam[0] })
  } catch (err) {
    const code = (err as { code?: string })?.code
          ?? (err as { cause?: { code?: string } })?.cause?.code
        if (code === '23505') throw new ConflictError('A team with this name already exists')
        throw err
  }
  
})
teamRouter.get('/:teamId', requireRole('member'), async (req, res) => {
  const params = teamIdParamSchema.safeParse(req.params)
  if (!params.success) throw new ValidationError(params.error.flatten())
  const { teamId } = params.data
  const [team] = await db.select({
        id: teams.id,
        name: teams.name,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .where(and(
        eq(teams.id, teamId),
        eq(teams.organizationId, req.membership!.organizationId),
      ))
      .limit(1)
  if (!team) throw new NotFoundError('Team not found')

  res.status(200).json({ success: true, team })
})
teamRouter.patch('/:teamId', requireRole('admin'), async (req, res) => {
  const params = teamIdParamSchema.safeParse(req.params)
  if (!params.success) throw new ValidationError(params.error.flatten())
  const { teamId } = params.data
  const updateResult = updateTeamSchema.safeParse(req.body)
  if (!updateResult.success) throw new ValidationError(updateResult.error.flatten())
  const { name } = updateResult.data
  try {
    const [updatedTeam] = await db.update(teams)
      .set({ name })
      .where(and(
        eq(teams.id, teamId),
        eq(teams.organizationId, req.membership!.organizationId),
      ))
      .returning()
    if (!updatedTeam) throw new NotFoundError('Team not found')
    res.status(200).json({ success: true, team: updatedTeam })
  } catch (err) {
    const code = (err as { code?: string })?.code
          ?? (err as { cause?: { code?: string } })?.cause?.code
        if (code === '23505') throw new ConflictError('A team with this name already exists')
        throw err
  }
})
teamRouter.delete('/:teamId', requireRole('admin'), async (req, res) => {
  const params = teamIdParamSchema.safeParse(req.params)
  if (!params.success) throw new ValidationError(params.error.flatten())
  const { teamId } = params.data
  const organizationId = req.membership!.organizationId
  const deleted = await db.transaction(async (tx)=> {
    const [team] = await tx.select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)))
      .limit(1)
      .for('update')
    if (!team) throw new NotFoundError('Team not found')
    const [project] = await tx.select({ id: projects.id })
      .from(projects)
      .where(eq(projects.teamId, teamId))
      .limit(1)
    if (project) throw new ConflictError('Team still has projects')
    const [row] = await tx.delete(teams)
      .where(eq(teams.id, teamId))
      .returning()
    return row
  })
  res.status(200).json({ success: true, team: deleted })
})
// Nested one level deeper: `loadTeam` resolves `:teamId` scoped to the caller's
// organization, so every project handler can trust `req.team`.
teamRouter.use('/:teamId/projects', loadTeam, projectRouter)

export default teamRouter
