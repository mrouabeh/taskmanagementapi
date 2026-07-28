
import { z } from 'zod'

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, { message: "Name is required" }).max(100),
})
export const updateTeamSchema = createTeamSchema

export const teamIdParamSchema = z.object({
  teamId: z.coerce.number().int().positive().safe(),
})