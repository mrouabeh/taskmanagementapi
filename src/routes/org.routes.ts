import { Router } from 'express'
import { db } from '../db'
import { organizations, memberships } from '../db/schema'
import { auth } from '../middleware/auth'
import { createOrgSchema } from '../validation/org.schema'
import { ConflictError, ValidationError } from "../lib/errors";


const router = Router()
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
router.post('/', auth, async (req, res) => {
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
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictError('An organization with this slug already exists')
      }
      throw err
    }
  
    res.status(201).json({ success: true, organization: insertedOrg })
  })
export default router;