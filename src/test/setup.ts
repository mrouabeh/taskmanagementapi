import { beforeAll, beforeEach, afterAll } from 'vitest'
import { redisClient } from '../redis'
import { db } from '../db'

// index.ts normally connects Redis at boot, but tests don't run index.ts.
beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect()
})

// The rate limiter counts requests per IP in Redis. Every test hits the app from
// the same IP, so without a reset one test's requests would push the next over
// the limit. Clear the counters before each test so tests stay independent.
beforeEach(async () => {
    const keys = await redisClient.keys('rate:*')
    if (keys.length) await redisClient.del(keys)
})

// Leave no open handles, or Vitest hangs instead of exiting.
afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit()
    await db.$client.end()
})
