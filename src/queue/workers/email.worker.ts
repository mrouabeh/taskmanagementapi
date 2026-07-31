import { Worker } from 'bullmq'
import { queueConnection } from '../connection'
import { env } from '../../config/env'
import { sendMail } from '../../lib/mailer'
import type { EmailJob } from '../queues'

function passwordResetMessage(job: EmailJob) {
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(job.token)}`
  const greeting = job.name ? `Hi ${job.name},` : 'Hi,'
  return {
    to: job.to,
    subject: 'Reset your password',
    text: `${greeting}\n\nUse this link to reset your password. It expires in 30 minutes and works once:\n\n${link}\n\nIf you didn't request this, ignore this email — your password is unchanged.`,
    html: `<p>${greeting}</p><p>Use this link to reset your password. It expires in 30 minutes and works once:</p><p><a href="${link}">Reset your password</a></p><p>If you didn't request this, ignore this email — your password is unchanged.</p>`,
  }
}

export const emailWorker = new Worker<EmailJob>(
  'email',
  async (job) => {
    switch (job.name) {
      case 'password-reset':
        await sendMail(passwordResetMessage(job.data))
        return
      default:
        // Retrying won't help an unknown job name, so fail it outright.
        throw new Error(`Unknown email job: ${job.name}`)
    }
  },
  { connection: queueConnection, prefix: env.QUEUE_PREFIX, concurrency: env.QUEUE_CONCURRENCY },
)

// Workers run outside Express, so errorHandler never sees any of this.
emailWorker.on('failed', (job, err) => {
  console.error(`email job ${job?.id} (${job?.name}) failed:`, err)
})
