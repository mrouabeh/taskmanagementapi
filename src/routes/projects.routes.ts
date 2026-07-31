import { Router } from 'express'
import { db } from '../db'
import { teams, projects } from '../db/schema'
import { requireRole } from '../middleware/requireRole'
import { and, eq } from 'drizzle-orm'
import { ValidationError, ConflictError, NotFoundError } from '../lib/errors'
import {
  createProjectSchema,
  updateProjectSchema,
  projectIdParamSchema,
} from '../validation/projects.schema'
import { loadProject } from '../middleware/loadProject'
import taskRouter from './tasks.routes'

const projectRouter = Router({ mergeParams: true })

projectRouter.get('/', requireRole('member'), async (req, res) => {
  const teamId = req.team!.id
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(eq(projects.teamId, teamId))
  res.status(200).json({ success: true, projects: rows })
})
projectRouter.get('/:projectId', requireRole('member'), async (req, res) => {
  const result = projectIdParamSchema.safeParse(req.params)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { projectId } = result.data
  const [rows] = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(and(eq(projects.teamId, req.team!.id), eq(projects.id, projectId)))
  if (!rows) throw new NotFoundError('Project not found')
  res.status(200).json({ success: true, project: rows })
})
projectRouter.post('/', requireRole('member'), async (req, res) => {
  const result = createProjectSchema.safeParse(req.body)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { name, description, status } = result.data
  try {
    const created = await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, req.team!.id)).for('update')
      const [row] = await tx
        .insert(projects)
        .values({ teamId: req.team!.id, name, description, status })
        .returning()
      return row
    })
    res.status(201).json({ success: true, project: created })
  } catch (err) {
    const code =
      (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
    if (code === '23505')
      throw new ConflictError('A project with this name corresponding to the team already exists')
    throw err
  }
})
projectRouter.delete('/:projectId', requireRole('admin'), async (req, res) => {
  const result = projectIdParamSchema.safeParse(req.params)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { projectId } = result.data
  const [deleted] = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, req.team!.id)))
    .returning()
  if (!deleted) throw new NotFoundError('Project not found')
  res.status(200).json({ success: true, project: deleted })
})
projectRouter.patch('/:projectId', requireRole('member'), async (req, res) => {
  const result = projectIdParamSchema.safeParse(req.params)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { projectId } = result.data
  const updatedResult = updateProjectSchema.safeParse(req.body)
  if (!updatedResult.success) throw new ValidationError(updatedResult.error.flatten())
  const { name, description, status } = updatedResult.data
  const archivedAt = status === undefined ? undefined : status === 'archived' ? new Date() : null
  try {
    const [updated] = await db
      .update(projects)
      .set({ name, description, status, archivedAt, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.teamId, req.team!.id)))
      .returning()
    if (!updated) throw new NotFoundError('Project not found')
    res.status(200).json({ success: true, project: updated })
  } catch (err) {
    const code =
      (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
    if (code === '23505')
      throw new ConflictError('A project with this name already exists in this team')
    throw err
  }
})

projectRouter.use('/:projectId/tasks', loadProject, taskRouter)
export default projectRouter
