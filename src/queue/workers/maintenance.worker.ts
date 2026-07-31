import { Worker } from 'bullmq'
import { lt } from 'drizzle-orm'
import { queueConnection } from '../connection'
import { env } from '../../config/env'
import { db } from '../../db'
import { passwordResetTokens } from '../../db/schema'
import { maintenanceQueue } from '../queues'

export const maintenanceWorker = new Worker(
  'maintenance',
  async (job) => {
    switch (job.name) {
      case 'purge-reset-tokens': {
        // Expiry is enforced in the query at /auth/reset-password; this only
        // stops the table from growing without bound.
        const deleted = await db
          .delete(passwordResetTokens)
          .where(lt(passwordResetTokens.expiresAt, new Date()))
          .returning({ id: passwordResetTokens.id })
        console.log(`Purged ${deleted.length} expired password reset tokens`)
        return
      }
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`)
    }
  },
  { connection: queueConnection, prefix: env.QUEUE_PREFIX, concurrency: 1 },
)

maintenanceWorker.on('failed', (job, err) => {
  console.error(`maintenance job ${job?.id} (${job?.name}) failed:`, err)
})

/** Idempotent — re-running just updates the existing schedule. */
export async function registerSchedules() {
  await maintenanceQueue.upsertJobScheduler(
    'purge-reset-tokens',
    { pattern: '0 * * * *' },
    { name: 'purge-reset-tokens' },
  )
}
