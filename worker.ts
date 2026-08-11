import { queueConnection } from './src/queue/connection'
import { Worker } from 'bullmq'
import { env } from './src/config/env'
import { sendMail } from './src/lib/mailer'

const emailWorker = new Worker(
  'email',
  async (job) => {
    switch (job.name) {
      case 'password-reset': {
        const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(job.data.token)}`
        await sendMail({
          to: job.data.to,
          subject: 'Reset your password',
          text: `Use this link to reset your password. It expires in 30 minutes:\n\n${link}`,
          html: `<p>Use this link to reset your password. It expires in 30 minutes:</p><p><a href="${link}">Reset your password</a></p>`,
        })
        return
      }
      default:
        throw new Error(`Unknown email job: ${job.name}`)
    }
  },
  { connection: queueConnection },
)

emailWorker.on('failed', (job, err) => {
  console.error(`email job ${job?.id} failed:`, err)
})
