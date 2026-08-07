import { queueConnection } from './src/queue/connection'
import { Worker } from 'bullmq'

const emailWorker = new Worker(
  'email',
  async (job) => {
    switch (job.name) {
      case 'password-reset': {
        const link = `http://localhost:3000/reset-password?token=${job.data.token}`
        console.log(`Reset link for ${job.data.to}: ${link}`)
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
