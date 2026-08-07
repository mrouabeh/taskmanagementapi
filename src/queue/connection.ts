import { env } from '../config/env'
import { Redis } from 'ioredis'

export const queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
