import {z} from 'zod'
import "dotenv/config"
export const schema = z.object({
    DATABASE_URL : z.string().min(1),
    REDIS_URL : z.string().min(1),
    PORT : z.coerce.number().default(3000),
    JWT_SECRET:z.string().min(1),
    NODE_ENV : z.enum(['development', 'test', 'production']).default('development'),
    REFRESH_SECRET: z.string().min(1)

})
const parsed = schema.safeParse(process.env)
if (!parsed.success) {
    console.error('Invalid environment variables:')
    console.error(parsed.error.flatten().fieldErrors)
    process.exit(1)
}
export const env = parsed.data