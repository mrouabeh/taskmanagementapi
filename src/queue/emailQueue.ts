import { queueConnection } from './connection'
import { Queue } from 'bullmq'

export const emailQueue = new Queue('email', {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnFail: { age: 604800 },
  },
})
