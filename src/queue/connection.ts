import IORedis from 'ioredis'
import { env } from '../config/env'

// BullMQ needs ioredis, not the node-redis client in src/redis.ts — the two
// stay separate. Workers block on BRPOPLPUSH, and ioredis's default retry cap
// would abort those commands, so Worker refuses to start unless it's null.
export const queueConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})

queueConnection.on('error', (e) => console.error('Queue Redis error:', e))
