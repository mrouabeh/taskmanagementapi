import { RequestHandler } from "express"
import { and, eq } from "drizzle-orm"
import { db } from "../db"
import { projects } from "../db/schema"
import { NotFoundError } from "../lib/errors"


export const loadProject: RequestHandler = async (req, res, next) => {
  const projectId = Number(req.params.projectId)
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new NotFoundError("Project not found")
  }
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      eq(projects.teamId, req.team!.id),
    ))
    .limit(1)
  if (!rows[0]) throw new NotFoundError("Project not found")
  req.project = { id: rows[0].id }
  next()
}
