import { Router } from 'express'
import { db } from '../db'
import { organizations, memberships } from '../db/schema'
import { auth } from '../middleware/auth'
import { createOrgSchema, updateOrgSchema } from '../validation/org.schema'
import { ConflictError, ValidationError , NotFoundError} from "../lib/errors";
import { eq } from 'drizzle-orm'
import { loadMembership, requireRole } from '../middleware/requireRole'


const organizationRouter = Router()
function slugify(text: string): string {
  return text
    .normalize('NFD')                   // Separate base characters from accent marks (e.g., 'é' -> 'e' + '´')
    .replace(/[\u0300-\u036f]/g, '')    // Remove the accent marks
    .toLowerCase()                      // Convert to lowercase
    .trim()                             // Remove leading and trailing whitespace
    .replace(/[^a-z0-9 -]/g, '')        // Remove invalid characters (keep letters, numbers, spaces, and dashes)
    .replace(/\s+/g, '-')               // Replace one or more spaces with a single dash
    .replace(/-+/g, '-');              // Replace multiple consecutive dashes with a single dash
}
organizationRouter.post('/', auth, async (req, res) => {
  const result = createOrgSchema.safeParse(req.body)
  if (!result.success){
      throw new ValidationError(result.error.flatten())
  }
  const {name,slug}=result.data
  const finalSlug = slug ?? slugify(name)
  let insertedOrg
    try {
      insertedOrg = await db.transaction(async (tx) => {
        const [org] = await tx.insert(organizations).values({ name, slug: finalSlug }).returning()
        await tx.insert(memberships).values({ userRole: 'owner', userId: req.user!.sub, organizationId: org.id })
        return org
      })
    } catch (err) {
      // drizzle 1.0-rc wraps DB errors in a DrizzleQueryError, so the Postgres
      // error code lives on `.cause`; a plain query would expose it at the top.
      const code = (err as { code?: string })?.code
        ?? (err as { cause?: { code?: string } })?.cause?.code
      if (code === '23505') {
        throw new ConflictError('An organization with this slug already exists')
      }
      throw err
    }
  
    res.status(201).json({ success: true, organization: insertedOrg })
  })

organizationRouter.get('/', auth, async (req, res) => {
  const listedOrgs = await db.select({
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
    createdAt: organizations.createdAt,
    role: memberships.userRole,
  })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, req.user!.sub))

  res.json({ success: true, userId: req.user!.sub, organizations: listedOrgs })
})
organizationRouter.get('/:orgId', auth, loadMembership, async (req, res) => {
  const orgId = Number(req.params.orgId)
  const [org] = await db.select({id: organizations.id, name: organizations.name, slug: organizations.slug, createdAt: organizations.createdAt})
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  if (!org) throw new NotFoundError('Organization not found')
  res.json({ success: true, organization: {...org, role: req.membership!.role} })
})
organizationRouter.patch('/:orgId', auth, loadMembership,requireRole("admin"), async (req, res) => {
  const result = updateOrgSchema.safeParse(req.body)
  const orgId = Number(req.params.orgId)
  if (!result.success) throw new ValidationError(result.error.flatten())
  const data = result.data
  try {
    const [updated] = await db.update(organizations)
      .set(data)
      .where(eq(organizations.id, orgId))
      .returning()
    res.json({success:true,organization: updated})
  } catch (err) {
    const code = (err as { code?: string })?.code
        ?? (err as { cause?: { code?: string } })?.cause?.code
      if (code === '23505') throw new ConflictError('An organization with this slug already exists')
      throw err
  }
})
organizationRouter.delete('/:orgId', auth, loadMembership, requireRole("owner"), async (req, res) => {
  const orgId = Number(req.params.orgId)
  const [deleted] = await db.delete(organizations)
    .where(eq(organizations.id, orgId))
    .returning()
  if (!deleted) throw new NotFoundError('Organization not found')
  res.json({ success: true, organization: deleted })
  
})
export default organizationRouter;