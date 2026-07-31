import { z } from 'zod'
import 'dotenv/config'
export const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REFRESH_SECRET: z.string().min(1),
  // Namespaces every BullMQ key. Left unset it derives from NODE_ENV, so test
  // runs never enqueue into a queue a real worker is draining.
  QUEUE_PREFIX: z.string().optional(),
  QUEUE_CONCURRENCY: z.coerce.number().default(5),
  // Base of the frontend that serves the reset form; the emailed link is built
  // from it, so a wrong value sends users somewhere that can't complete a reset.
  APP_URL: z.string().url().default('http://localhost:3000'),
  // Any provider that speaks SMTP. Unset means "don't send" — the worker logs
  // the link instead, which is what you want in development and tests.
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@localhost'),
})
const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}
export const env = {
  ...parsed.data,
  QUEUE_PREFIX:
    parsed.data.QUEUE_PREFIX ?? (parsed.data.NODE_ENV === 'test' ? 'bull:test' : 'bull'),
}
