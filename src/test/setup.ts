import { beforeAll, beforeEach, afterAll } from 'vitest'
import { redisClient } from '../redis'
import { db } from '../db'
import { emailQueue } from '../queue/emailQueue'
import { queueConnection } from '../queue/connection'

// index.ts normally connects Redis at boot, but tests don't run index.ts.
beforeAll(async () => {
  if (!redisClient.isOpen) await redisClient.connect()
})

// The rate limiter counts requests per IP in Redis. Every test hits the app from
// the same IP, so without a reset one test's requests would push the next over
// the limit. Clear the counters before each test so tests stay independent.
// No worker runs during tests, so queued jobs would pile up and one test would
// read a job another test left behind. Clear them too.
beforeEach(async () => {
  const keys = await redisClient.keys('rate:*')
  if (keys.length) await redisClient.del(keys)
  const jobKeys = await redisClient.keys('bull:*')
  if (jobKeys.length) await redisClient.del(jobKeys)
})

// Leave no open handles, or Vitest hangs instead of exiting. BullMQ's connection
// is separate from redisClient, so it needs closing on its own.
afterAll(async () => {
  await emailQueue.close()
  if (redisClient.isOpen) await redisClient.quit()
  if (queueConnection.status !== 'end') await queueConnection.quit()
  await db.$client.end()
})
