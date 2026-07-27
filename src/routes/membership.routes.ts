import { Router } from 'express'
import {auth} from "../middleware/auth";
import {loadMembership,requireRole,ROLE_RANK,type Role} from "../middleware/requireRole";
import {db} from "../db";
import { memberships, users } from "../db/schema";
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from '../lib/errors'
import {eq,and} from "drizzle-orm";
import { addMemberSchema,membershipIdParamSchema } from '../validation/membership.schema';

function assertCanManage(actor: Role, target: Role) {
  if (ROLE_RANK[target] >= ROLE_RANK.admin && actor !== 'owner') throw new ForbiddenError()
}
const membershipRouter = Router({ mergeParams: true })
membershipRouter.use(auth, loadMembership)

membershipRouter.get('/', requireRole('member'), async (req, res) => {
  const members = await db.select({
        id: memberships.id,
        role: memberships.userRole,
        userId: users.id,
        email: users.email,
        name: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, req.membership!.organizationId))
  res.status(200).json({ success:true,members })
})

membershipRouter.post('/', requireRole('admin'), async (req, res) => {
  const result = addMemberSchema.safeParse(req.body)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const { email, role } = result.data
  const organizationId = req.membership!.organizationId
  assertCanManage(req.membership!.role,role)
  let userId = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (!userId[0]) throw new NotFoundError('User not found')
  let insertResult
  try {
    
    insertResult = await db.insert(memberships).values({
      userId: userId[0].id,          // resolved from the email, not the email itself
      organizationId,           // from req.membership!.organizationId
      userRole: role,           // from the parsed body
    }).returning()
    res.status(201).json({ success: true, member: insertResult[0] })
  } catch (err) {
    const code = (err as { code?: string })?.code
        ?? (err as { cause?: { code?: string } })?.cause?.code
    if (code === '23505') {
        throw new ConflictError('User is already a member of this organization')
    }
    throw err
    }
  
})
membershipRouter.delete('/:membershipId', requireRole('admin'), async (req, res) => {
  const safeParams = membershipIdParamSchema.safeParse(req.params)
  if (!safeParams.success) throw new ValidationError(safeParams.error.flatten())
  const { membershipId } = safeParams.data
  const organizationId = req.membership!.organizationId
  const deleted = await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: memberships.id, role: memberships.userRole })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .limit(1)
    if (!target) throw new NotFoundError('Membership not found')
    assertCanManage(req.membership!.role, target.role)
    if (target.role === 'owner') {
      const owners = await tx.select({ id: memberships.id })
        .from(memberships)
        .where(and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userRole, 'owner'),
        ))
        .for('update')
      if (owners.length <= 1) throw new ConflictError('Organisation must have one owner at least')
    }
    const [row] = await tx.delete(memberships)
      .where(eq(memberships.id, membershipId))
      .returning()
    return row
  })
  res.json({ success: true, membership: deleted })
})
export default membershipRouter
