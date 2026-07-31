import type { Role } from '../middleware/requireRole'

declare global {
  namespace Express {
    interface Request {
      user?: { sub: number; jti: string; exp: number; sid: string }
      membership?: { id: number; organizationId: number; role: Role }
      team?: { id: number }
      project?: { id: number }
      task?: { id: number }
    }
  }
}

export {}
