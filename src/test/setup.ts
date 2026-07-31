import { beforeAll, beforeEach, afterAll } from 'vitest'
import { redisClient } from '../redis'
import { db } from '../db'
import { env } from '../config/env'
import { queueConnection } from '../queue/connection'
import { emailQueue, maintenanceQueue } from '../queue/queues'

// index.ts normally connects Redis at boot, but tests don't run index.ts.
beforeAll(async () => {
  if (!redisClient.isOpen) await redisClient.connect()
})

// The rate limiter counts requests per IP in Redis. Every test hits the app from
// the same IP, so without a reset one test's requests would push the next over
// the limit. Clear the counters before each test so tests stay independent.
// Queued jobs would otherwise leak between files, since no worker drains them
// here. QUEUE_PREFIX is `bull:test` under NODE_ENV=test, so this can't touch a
// dev queue.
beforeEach(async () => {
  const keys = await redisClient.keys('rate:*')
  if (keys.length) await redisClient.del(keys)
  const jobKeys = await redisClient.keys(`${env.QUEUE_PREFIX}:*`)
  if (jobKeys.length) await redisClient.del(jobKeys)
})

// Leave no open handles, or Vitest hangs instead of exiting. BullMQ's ioredis
// connection is a separate handle from redisClient and needs closing too.
afterAll(async () => {
  await emailQueue.close()
  await maintenanceQueue.close()
  if (redisClient.isOpen) await redisClient.quit()
  if (queueConnection.status !== 'end') await queueConnection.quit()
  await db.$client.end()
})
