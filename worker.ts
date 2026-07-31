import { emailWorker } from './src/queue/workers/email.worker'
import { maintenanceWorker, registerSchedules } from './src/queue/workers/maintenance.worker'
import { queueConnection } from './src/queue/connection'
import { closeMailer } from './src/lib/mailer'
import { db } from './src/db'

// Runs as its own process, not inside index.ts: a handler that crashes the
// runtime must not take the API down with it.

await registerSchedules()
console.log('Workers started: email, maintenance')

async function shutdown(signal: string) {
  console.log(`${signal} received, draining workers...`)
  // close() waits for in-flight jobs before returning.
  await Promise.allSettled([emailWorker.close(), maintenanceWorker.close()])
  await closeMailer()
  await queueConnection.quit()
  await db.$client.end()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason)
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  process.exit(1)
})
