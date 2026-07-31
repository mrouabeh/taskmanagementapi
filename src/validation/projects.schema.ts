import { z } from 'zod'
import { projectStatus } from '../db/schema'

const statusSchema = z.enum(projectStatus.enumValues)

const nameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Name is required' })
  .max(255, { message: 'Name must be less or equal to 255 characters' })

const descriptionSchema = z.string().trim().max(10000).nullish()

export const createProjectSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  status: statusSchema.default('planning'),
})

export const updateProjectSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema,
    status: statusSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' })

export const projectIdParamSchema = z.object({
  projectId: z.coerce.number().int().positive().safe(),
})

export type createProjectZ = z.infer<typeof createProjectSchema>
export type updateProjectZ = z.infer<typeof updateProjectSchema>
export type ProjectIdParamZ = z.infer<typeof projectIdParamSchema>
