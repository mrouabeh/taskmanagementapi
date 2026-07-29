import type { Role } from "../middleware/requireRole"

// `user` is optional because it only exists after `auth` has run.
declare global {
    namespace Express {
        interface Request {
            user?: { sub: number; jti: string; exp: number; sid: string }
            membership?: { id: number; organizationId: number; role: Role }
            // Set by `loadTeam`, which has already scoped the lookup to
            // `membership.organizationId` — so this id is safe to trust.
            team?: { id: number }
        }
    }
}

export {}
