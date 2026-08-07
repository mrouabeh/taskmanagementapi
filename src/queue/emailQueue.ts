import { queueConnection } from './connection'
import { Queue } from 'bullmq'

export const emailQueue = new Queue('email', {
  connection: queueConnection,
  defaultJobOptions: {
    // job.data holds the raw reset token, so don't leave finished jobs in Redis.
    removeOnComplete: true,
  },
})
