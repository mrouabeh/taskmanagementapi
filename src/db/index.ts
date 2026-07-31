import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../config/env'
import { relations } from './relations'
export const db = drizzle(env.DATABASE_URL, { relations })
