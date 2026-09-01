import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import authRouter from './routes/auth.routes'
import cookieParser from 'cookie-parser'
import express from 'express'
const app = express()
import organizationRouter from './routes/org.routes'
import { rateLimiter } from './middleware/rateLimiter'

app.use(rateLimiter)
app.use(express.json())
app.use(cookieParser())
app.use('/auth', authRouter)
app.use('/orgs', organizationRouter)
app.use(notFoundHandler)
app.use(errorHandler)
export default app
