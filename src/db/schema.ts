import {
  pgEnum,
  pgTable,
  bigint,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  foreignKey,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', ['owner', 'admin', 'member', 'guest'])
export const projectStatus = pgEnum('project_status', [
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
])

export const taskStatus = pgEnum('task_status', [
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
])
export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent'])

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: bigint('organization_id', { mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: varchar({ length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: bigint('entity_id', { mode: 'number' }),
    description: text(),
    metadata: jsonb(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index('activity_logs_entity_idx').using(
      'btree',
      table.entityType.asc().nullsLast(),
      table.entityId.asc().nullsLast(),
    ),
    index('idx_activity_logs_organization_id').using(
      'btree',
      table.organizationId.asc().nullsLast(),
    ),
  ],
)

export const memberships = pgTable(
  'memberships',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity().notNull(),
    userRole: userRole('user_role').default('guest').notNull(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: bigint('organization_id', { mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('ck').on(table.userId, table.organizationId),
    index('memberships_organization_id_idx').using('btree', table.organizationId.asc().nullsLast()),
  ],
)

export const organizations = pgTable(
  'organizations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 100 }).notNull(),
    slug: varchar({ length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
  },
  (table) => [unique('organizations_slug_key').on(table.slug)],
)

export const projects = pgTable(
  'projects',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    teamId: bigint('team_id', { mode: 'number' })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar({ length: 255 }).notNull(),
    description: text(),
    status: projectStatus().default('planning').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Nullable + SET NULL: a project outlives the account that created it.
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [unique('projects_team_id_name_key').on(table.teamId, table.name)],
)

// No unique constraint on title: two tasks may share a name within a project,
// unlike teams and projects, which are uniquely named within their parent.
export const tasks = pgTable(
  'tasks',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar({ length: 255 }).notNull(),
    description: text(),
    status: taskStatus().default('todo').notNull(),
    priority: taskPriority().default('medium').notNull(),
    assigneeId: bigint('assignee_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('tasks_project_id_idx').using('btree', table.projectId.asc().nullsLast()),
    index('tasks_assignee_id_idx').using('btree', table.assigneeId.asc().nullsLast()),
  ],
)

export const comments = pgTable(
  'comments',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    taskId: bigint('task_id', { mode: 'number' })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [index('comments_task_id_idx').using('btree', table.taskId.asc().nullsLast())],
)

export const teams = pgTable(
  'teams',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    organizationId: bigint('organization_id', { mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
  },
  (table) => [unique('teams_org_name_unique').on(table.organizationId, table.name)],
)

export const users = pgTable(
  'users',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({ maxValue: 2147483647 }),
    email: varchar({ length: 255 }).notNull(),
    hashedpassword: varchar({ length: 255 }),
    name: varchar({ length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
  },
  (table) => [unique('users_pk_2').on(table.email)],
)
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [unique('password_reset_tokens_hash_key').on(table.tokenHash)],
)
