import { Router, type Request } from 'express'
import { db } from '../db'
import { comments } from '../db/schema'
import { requireRole, ROLE_RANK } from '../middleware/requireRole'
import { and, eq, asc } from 'drizzle-orm'
import { commentIdParamSchema, createCommentSchema, updateCommentSchema } from "../validation/comments.schema";
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'

// `auth`, `loadMembership`, `loadTeam`, `loadProject` and `loadTask` all run on
// the parent chain, so `req.task` is already resolved and scoped.
const commentsRouter = Router({ mergeParams: true })

/**
 * Fetches a comment scoped to the task, then decides whether the caller may
 * change it.
 *
 * `requireRole` gates who may *call* a route; it cannot express "the person who
 * wrote this row", because that needs the row. Hence the check lives here.
 *
 * Order matters: 404 before 403. Checking permission first would let a caller
 * probe for comment ids on other tasks by reading the status code.
 */
async function loadEditableComment(req: Request, commentId: number) {
    const [comment] = await db.select()
        .from(comments)
        .where(and(
            eq(comments.id, commentId),
            eq(comments.taskId, req.task!.id),
        ))
        .limit(1)
    if (!comment) throw new NotFoundError('Comment not found')

    // `userId` is nullable — a deleted account leaves it null, and
    // `null === sub` is false, so those comments become admin-only.
    const isAuthor = comment.userId === req.user!.sub
    const isAdmin = ROLE_RANK[req.membership!.role] >= ROLE_RANK.admin
    if (!isAuthor && !isAdmin) throw new ForbiddenError()

    return comment
}

commentsRouter.get('/', requireRole('member'), async (req, res) => {
    // A thread is the one list where order is part of the meaning — without an
    // ORDER BY, Postgres may return rows in any order it likes.
    const selected = await db.select({
        id: comments.id,
        body: comments.body,
        userId: comments.userId,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
    }).from(comments).where(eq(comments.taskId, req.task!.id)).orderBy(asc(comments.createdAt))
    res.status(200).json({ success: true, comments: selected })
})

commentsRouter.post('/', requireRole('member'), async (req, res) => {
    const result = createCommentSchema.safeParse(req.body)
    if (!result.success) throw new ValidationError(result.error.flatten())
    const { body } = result.data
    const [inserted] = await db.insert(comments).values({
        body,
        taskId: req.task!.id,
        userId: req.user!.sub,
    }).returning()
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

    const [updated] = await db.update(comments)
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
    const [deleted] = await db.delete(comments)
        .where(and(eq(comments.id, commentId), eq(comments.taskId, req.task!.id)))
        .returning()
    if (!deleted) throw new NotFoundError('Comment not found')

    res.status(200).json({ success: true, comment: deleted })
})

export default commentsRouter
