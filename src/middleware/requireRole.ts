import { RequestHandler } from "express"
import { and, eq } from "drizzle-orm"
import { db } from "../db"
import { memberships } from "../db/schema"
import { ForbiddenError, NotFoundError } from "../lib/errors"

const ROLE_RANK = { guest: 0, member: 1, admin: 2, owner: 3 } as const 
export type Role = keyof typeof ROLE_RANK

export const loadMembership: RequestHandler = async (req, res, next) => {
  const orgId = Number(req.params.orgId)
  // Same message as the not-a-member case below, so a bad id and a real
  // organization the caller can't see are indistinguishable from outside.
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new NotFoundError("Organization not found")
  }
  const rows = await db
         .select({ role: memberships.userRole })
         .from(memberships)
         .where(and(
             eq(memberships.userId, req.user!.sub),
             eq(memberships.organizationId, orgId),
         ))
    .limit(1)
  if (!rows[0]) throw new NotFoundError("Organization not found")
  req.membership = { organizationId: orgId, role: rows[0].role }
  next()
  
}
export function requireRole(min: Role): RequestHandler {
  return (req, res, next) => {
    // Already a member by this point, so 403 leaks nothing new.
    if (ROLE_RANK[req.membership!.role] < ROLE_RANK[min]) throw new ForbiddenError()
    next()
  }
}
