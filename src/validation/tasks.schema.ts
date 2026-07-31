import { z } from 'zod'
import { taskStatus, taskPriority } from '../db/schema'

const titleSchema = z.string().trim().min(1, { message: 'Title is required' }).max(255)
const descriptionSchema = z.string().trim().max(10000).nullish()
const statusSchema = z.enum(taskStatus.enumValues)
const prioritySchema = z.enum(taskPriority.enumValues)
const dueDateSchema = z.coerce.date().nullish()
const assigneeIdSchema = z.coerce.number().int().positive().safe().nullish()

export const createTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  status: statusSchema.default('todo'),
  priority: prioritySchema.default('medium'),
  assigneeId: assigneeIdSchema,
  dueDate: dueDateSchema,
})

// PATCH: any subset of the mutable fields, but the body can't be empty.
export const updateTaskSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema,
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    assigneeId: assigneeIdSchema,
    dueDate: dueDateSchema,
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' })

export const taskIdParamSchema = z.object({
  taskId: z.coerce.number().int().positive().safe(),
})

export type createTaskZ = z.infer<typeof createTaskSchema>
export type updateTaskZ = z.infer<typeof updateTaskSchema>
export type TaskIdParamZ = z.infer<typeof taskIdParamSchema>
