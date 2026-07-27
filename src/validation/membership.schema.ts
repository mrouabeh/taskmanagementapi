import { z } from 'zod'
import { userRole } from '../db/schema'


const roleSchema = z.enum(userRole.enumValues)


const emailSchema = z.string().trim().toLowerCase().pipe(z.email({ message: "Invalid email" }))

export const addMemberSchema = z.object({
  email: emailSchema,
  role: roleSchema.default('member'),
})

export const updateMemberRoleSchema = z.object({
  role: roleSchema,
})
export const membershipIdParamSchema = z.object({
  membershipId: z.coerce.number().int().positive().safe(),
})
export type MembershipIdParamZ = z.infer<typeof membershipIdParamSchema>
export type addMemberZ = z.infer<typeof addMemberSchema>
export type updateMemberRoleZ = z.infer<typeof updateMemberRoleSchema>
