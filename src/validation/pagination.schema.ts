import { z } from 'zod'

export const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000, { message: 'Pagination exceeds 10,000' })
    .safe()
    .default(1),
  limit: z.coerce.number().int().positive().max(100, { message: 'Limit exceeds 100' }).default(20),
})
export type paginationZ = z.infer<typeof paginationSchema>
