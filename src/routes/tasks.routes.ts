import { Router } from 'express'
import { db } from '../db'
import { tasks, memberships } from '../db/schema'
import { requireRole } from '../middleware/requireRole'
import { and, eq } from 'drizzle-orm'
import { ValidationError, NotFoundError } from '../lib/errors'
import {createTaskSchema, taskIdParamSchema, updateTaskSchema} from '../validation/tasks.schema'
import commentRouter from './comments.routes'
import { loadTask } from '../middleware/loadTask'

const taskRouter = Router({ mergeParams: true })

async function assertAssigneeIsMember(assigneeId: number | null | undefined, organizationId: number) {
  if (assigneeId == null) return
  const [row] = await db.select({ id: memberships.id })
    .from(memberships)
    .where(and(
      eq(memberships.userId, assigneeId),
      eq(memberships.organizationId, organizationId),
    ))
    .limit(1)
  if (!row) {
    throw new ValidationError({
      formErrors: [],
      fieldErrors: { assigneeId: ['User is not a member of this organization'] },
    })
  }
}

taskRouter.get('/', requireRole('member'), async (req, res) => {
    const selected = await db.select().from(tasks).where(eq(tasks.projectId, req.project!.id))
    res.status(200).json({ success: true, tasks: selected })
})

taskRouter.post('/', requireRole('member'), async (req, res) => {
    const result = createTaskSchema.safeParse(req.body)
    if (!result.success) throw new ValidationError(result.error.flatten())
    const { title, description, status, priority, assigneeId, dueDate } = result.data

    await assertAssigneeIsMember(assigneeId, req.membership!.organizationId)

    const [inserted] = await db.insert(tasks).values({
        title,
        description,
        status,
        priority,
        assigneeId,
        dueDate,
        projectId: req.project!.id,
        createdById: req.user!.sub,
    }).returning()

    res.status(201).json({ success: true, task: inserted })
})

taskRouter.get('/:taskId', requireRole('member'), async (req, res) => {
    const result = taskIdParamSchema.safeParse(req.params)
    if (!result.success) throw new ValidationError(result.error.flatten())
    const { taskId } = result.data

    const [selected] = await db.select()
      .from(tasks)
      .where(and(
        eq(tasks.id, taskId),
        eq(tasks.projectId, req.project!.id),
      ))
      .limit(1)
    if (!selected) throw new NotFoundError('Task not found')

    res.status(200).json({ success: true, task: selected })
})
taskRouter.patch('/:taskId', requireRole('member'), async (req, res) => {
    const paramResult = taskIdParamSchema.safeParse(req.params)
    if (!paramResult.success) throw new ValidationError(paramResult.error.flatten())
    const { taskId } = paramResult.data

    const updateResult = updateTaskSchema.safeParse(req.body)
    if (!updateResult.success) throw new ValidationError(updateResult.error.flatten())
    const { title, description, status, priority, assigneeId, dueDate } = updateResult.data
    await assertAssigneeIsMember(assigneeId, req.membership!.organizationId)
    let completedAt: Date | null | undefined
    if (status === undefined) completedAt = undefined
    else if (status === 'done') completedAt = new Date()
    else completedAt = null

    const [updated] = await db.update(tasks)
        .set({
          title, description, status, priority, assigneeId, dueDate,
          completedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, req.project!.id)))
        .returning()
    if (!updated) throw new NotFoundError('Task not found')

    res.status(200).json({ success: true, task: updated })
})
taskRouter.delete('/:taskId',requireRole('admin'),async(req,res)=>{
    const result = taskIdParamSchema.safeParse(req.params)
    if (!result.success) throw new ValidationError(result.error.flatten())
    const {taskId} = result.data
    const [deleted] = await db.delete(tasks)
        .where(and(eq(tasks.id,taskId),eq(tasks.projectId,req.project!.id)))
        .returning()
    if (!deleted) throw new NotFoundError('Task not found')
    res.status(200).json({ success: true, task: deleted })
})

taskRouter.use('/:taskId/comments', loadTask, commentRouter)
export default taskRouter;
