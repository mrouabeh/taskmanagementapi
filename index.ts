import { env } from './src/config/env'
import app from './src/app'
import { redisClient } from './src/redis'

// A rejected promise or throw that escapes Express leaves the process in an
// unknown state. Log loudly and exit so the supervisor restarts us clean.

async function startServer() {
  try {
    // Connect to Redis first
    await redisClient.connect()
    console.log('Connected to Redis successfully!')

    // Then start your Express app
    app.listen(env.PORT, () => {
      console.log(`Server is running on http://localhost:${env.PORT}`)
    })
  } catch (err) {
    console.error('Failed to start server due to Redis connection issue:', err)
    process.exit(1)
  }
}

startServer()

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason)
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  process.exit(1)
})
