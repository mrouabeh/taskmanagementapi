import { Router, type Request } from 'express'
import { db } from '../db'
import { comments } from '../db/schema'
import { requireRole, ROLE_RANK } from '../middleware/requireRole'
import { and, eq, asc } from 'drizzle-orm'
import {
  commentIdParamSchema,
  createCommentSchema,
  updateCommentSchema,
} from '../validation/comments.schema'
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'

const commentsRouter = Router({ mergeParams: true })

async function loadEditableComment(req: Request, commentId: number) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.taskId, req.task!.id)))
    .limit(1)
  if (!comment) throw new NotFoundError('Comment not found')
  const isAuthor = comment.userId === req.user!.sub
  const isAdmin = ROLE_RANK[req.membership!.role] >= ROLE_RANK.admin
  if (!isAuthor && !isAdmin) throw new ForbiddenError()
  return comment
}

commentsRouter.get('/', requireRole('member'), async (req, res) => {
  // A thread is the one list where order is part of the meaning — without an
  // ORDER BY, Postgres may return rows in any order it likes.
  const selected = await db
    .select({
      id: comments.id,
      body: comments.body,
      userId: comments.userId,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
    })
    .from(comments)
    .where(eq(comments.taskId, req.task!.id))
    .orderBy(asc(comments.createdAt))
  res.status(200).json({ success: true, comments: selected })
})

commentsRouter.post('/', requireRole('member'), async (req, res) => {
  const result = createCommentSchema.safeParse(req.body)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { body } = result.data
  const [inserted] = await db
    .insert(comments)
    .values({
      body,
      taskId: req.task!.id,
      userId: req.user!.sub,
    })
    .returning()
  res.status(201).json({ success: true, comment: inserted })
})

commentsRouter.patch('/:commentId', requireRole('member'), async (req, res) => {
  const result = commentIdParamSchema.safeParse(req.params)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { commentId } = result.data

  const bodyResult = updateCommentSchema.safeParse(req.body)
  if (!bodyResult.success) throw new ValidationError(bodyResult.error.flatten())
  const { body } = bodyResult.data

  await loadEditableComment(req, commentId)

  const [updated] = await db
    .update(comments)
    .set({
      body,
      updatedAt: new Date(),
    })
    .where(and(eq(comments.id, commentId), eq(comments.taskId, req.task!.id)))
    .returning()
  if (!updated) throw new NotFoundError('Comment not found')

  res.status(200).json({ success: true, comment: updated })
})

commentsRouter.delete('/:commentId', requireRole('member'), async (req, res) => {
  const result = commentIdParamSchema.safeParse(req.params)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { commentId } = result.data
  await loadEditableComment(req, commentId)
  const [deleted] = await db
    .delete(comments)
    .where(and(eq(comments.id, commentId), eq(comments.taskId, req.task!.id)))
    .returning()
  if (!deleted) throw new NotFoundError('Comment not found')

  res.status(200).json({ success: true, comment: deleted })
})

export default commentsRouter
