import { z } from 'zod'

const bodySchema = z.string()
  .trim()
  .min(1, { message: "Comment cannot be empty" })
  .max(300, { message: "Comment must be less or equal to 300 characters" })


export const createCommentSchema = z.object({
  body: bodySchema,
})

export const updateCommentSchema = z.object({
  body: bodySchema,
})

export const commentIdParamSchema = z.object({
  commentId: z.coerce.number().int().positive().safe(),
})

export type createCommentZ = z.infer<typeof createCommentSchema>
export type updateCommentZ = z.infer<typeof updateCommentSchema>
export type CommentIdParamZ = z.infer<typeof commentIdParamSchema>
