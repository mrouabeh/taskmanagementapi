import { Queue } from 'bullmq'
import { queueConnection } from './connection'
import { env } from '../config/env'

export type PasswordResetEmail = {
  to: string
  name: string | null
  token: string
}

export type EmailJob = PasswordResetEmail

export const emailQueue = new Queue<EmailJob>('email', {
  connection: queueConnection,
  prefix: env.QUEUE_PREFIX,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    // The raw reset token rides in the payload, so it sits in Redis until the
    // job is gone. Drop completed jobs immediately rather than keeping a window.
    removeOnComplete: true,
    removeOnFail: { age: 604800 },
  },
})

export const maintenanceQueue = new Queue('maintenance', {
  connection: queueConnection,
  prefix: env.QUEUE_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { age: 604800 },
  },
})

/**
 * Enqueue without letting a Redis outage fail the caller's request. Only for
 * work whose loss is acceptable — anything load-bearing should throw instead.
 */
export async function enqueueSafely<Q extends Queue<any, any, any>>(
  queue: Q,
  name: Parameters<Q['add']>[0],
  data: Parameters<Q['add']>[1],
) {
  try {
    await queue.add(name, data)
  } catch (err) {
    console.error(`Failed to enqueue ${queue.name}/${name}:`, err)
  }
}
