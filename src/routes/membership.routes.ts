import { Router } from 'express'
import { auth } from '../middleware/auth'
import { loadMembership, requireRole, ROLE_RANK, type Role } from '../middleware/requireRole'
import { db } from '../db'
import { memberships, users } from '../db/schema'
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from '../lib/errors'
import { eq, and } from 'drizzle-orm'
import {
  addMemberSchema,
  membershipIdParamSchema,
  updateMemberRoleSchema,
} from '../validation/membership.schema'

function assertCanManage(actor: Role, target: Role) {
  if (ROLE_RANK[target] >= ROLE_RANK.admin && actor !== 'owner') throw new ForbiddenError()
}
const membershipRouter = Router({ mergeParams: true })
membershipRouter.use(auth, loadMembership)

membershipRouter.get('/', requireRole('member'), async (req, res) => {
  const members = await db
    .select({
      id: memberships.id,
      role: memberships.userRole,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, req.membership!.organizationId))
  res.status(200).json({ success: true, members })
})

membershipRouter.post('/', requireRole('admin'), async (req, res) => {
  const result = addMemberSchema.safeParse(req.body)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { email, role } = result.data
  const organizationId = req.membership!.organizationId
  assertCanManage(req.membership!.role, role)
  let userId = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!userId[0]) throw new NotFoundError('User not found')
  let insertResult
  try {
    insertResult = await db
      .insert(memberships)
      .values({
        userId: userId[0].id, // resolved from the email, not the email itself
        organizationId, // from req.membership!.organizationId
        userRole: role, // from the parsed body
      })
      .returning()
    res.status(201).json({ success: true, member: insertResult[0] })
  } catch (err) {
    const code =
      (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
    if (code === '23505') {
      throw new ConflictError('User is already a member of this organization')
    }
    throw err
  }
})
// No `requireRole` gate: removing *someone else* needs admin, but removing your
// own membership is how you leave, and any member may do that. The distinction
// needs the target row, so it is enforced inside the transaction below.
membershipRouter.delete('/:membershipId', async (req, res) => {
  const safeParams = membershipIdParamSchema.safeParse(req.params)
  if (!safeParams.success) throw new ValidationError(safeParams.error.flatten())
  const { membershipId } = safeParams.data
  // Deleting your own membership is how you leave an organization. The
  // last-owner check below is what stops the final owner from orphaning it.
  const organizationId = req.membership!.organizationId
  const deleted = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: memberships.id, role: memberships.userRole })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .for('update')
      .limit(1)
    if (!target) throw new NotFoundError('Membership not found')
    // Leaving is always allowed; removing anyone else needs admin rank and
    // still obeys the owner-only ceiling.
    if (target.id !== req.membership!.id) {
      if (ROLE_RANK[req.membership!.role] < ROLE_RANK.admin) throw new ForbiddenError()
      assertCanManage(req.membership!.role, target.role)
    }
    if (target.role === 'owner') {
      const owners = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.organizationId, organizationId), eq(memberships.userRole, 'owner')),
        )
        .for('update')
      if (owners.length <= 1) throw new ConflictError('Organisation must have one owner at least')
    }
    const [row] = await tx.delete(memberships).where(eq(memberships.id, membershipId)).returning()
    return row
  })
  res.json({ success: true, membership: deleted })
})
membershipRouter.patch('/:membershipId', requireRole('admin'), async (req, res) => {
  const safeParams = membershipIdParamSchema.safeParse(req.params)
  if (!safeParams.success) throw new ValidationError(safeParams.error.flatten())
  const body = updateMemberRoleSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.flatten())
  const { membershipId } = safeParams.data
  const { role } = body.data
  if (membershipId === req.membership!.id && role !== req.membership!.role) {
    throw new ForbiddenError('You cannot modify your own role.')
  }
  const organizationId = req.membership!.organizationId
  const updated = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: memberships.id, role: memberships.userRole })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .for('update')
      .limit(1)
    if (!target) throw new NotFoundError('Membership not found')
    assertCanManage(req.membership!.role, target.role)
    assertCanManage(req.membership!.role, role)
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.organizationId, organizationId), eq(memberships.userRole, 'owner')),
        )
        .for('update')
      if (owners.length <= 1) throw new ConflictError('Organisation must have one owner at least')
    }
    const [row] = await tx
      .update(memberships)
      .set({ userRole: role })
      .where(eq(memberships.id, membershipId))
      .returning()
    return row
  })
  res.status(200).json({ success: true, membership: updated })
})
export default membershipRouter
