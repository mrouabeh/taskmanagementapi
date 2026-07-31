import { RequestHandler } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { tasks } from '../db/schema'
import { NotFoundError } from '../lib/errors'

export const loadTask: RequestHandler = async (req, res, next) => {
  const taskId = Number(req.params.taskId)
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new NotFoundError('Task not found')
  }
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, req.project!.id)))
    .limit(1)
  if (!rows[0]) throw new NotFoundError('Task not found')
  req.task = { id: rows[0].id }
  next()
}
