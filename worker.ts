import { queueConnection } from './src/queue/connection'
import { Worker } from 'bullmq'

new Worker(
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
