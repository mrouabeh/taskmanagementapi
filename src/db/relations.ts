import { defineRelations } from 'drizzle-orm'
import * as schema from './schema'

export const relations = defineRelations(schema, (r) => ({
  organizations: {
    usersViaActivityLogs: r.many.users({
      from: r.organizations.id.through(r.activityLogs.organizationId),
      to: r.users.id.through(r.activityLogs.userId),
      alias: 'organizations_id_users_id_via_activityLogs',
    }),
    usersViaMemberships: r.many.users({
      from: r.organizations.id.through(r.memberships.organizationId),
      to: r.users.id.through(r.memberships.userId),
      alias: 'organizations_id_users_id_via_memberships',
    }),
    teams: r.many.teams(),
  },
  users: {
    organizationsViaActivityLogs: r.many.organizations({
      alias: 'organizations_id_users_id_via_activityLogs',
    }),
    organizationsViaMemberships: r.many.organizations({
      alias: 'organizations_id_users_id_via_memberships',
    }),
  },
  projects: {
    team: r.one.teams({
      from: r.projects.teamId,
      to: r.teams.id,
    }),
  },
  teams: {
    projects: r.many.projects(),
    organization: r.one.organizations({
      from: r.teams.organizationId,
      to: r.organizations.id,
    }),
  },
}))
