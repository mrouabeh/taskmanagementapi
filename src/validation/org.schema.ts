import { z } from 'zod'

// Lowercase word chunks joined by single hyphens: "acme", "acme-corp", "my-org-2".
// No spaces, uppercase, underscores, or leading/trailing/doubled hyphens.
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const createOrgSchema = z.object({
  name: z.string()
    .trim()
    .min(1,{message: "Name is required"})
    .max(100,{message: "Name must be less or equal to 100 characters"}),
  slug: z.string()
    .max(100,{message: "Slug must be less or equal to 100 characters"})
    .regex(slugPattern,{message: "Slug must be lowercase letters, numbers, and single hyphens"})
    .optional(),
  
})

// PATCH: any subset of the create fields, but the body can't be empty.
export const updateOrgSchema = createOrgSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" })

export type createOrgZ = z.infer<typeof createOrgSchema>
export type updateOrgZ = z.infer<typeof updateOrgSchema>