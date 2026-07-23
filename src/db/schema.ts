import { pgEnum, pgTable, bigint, varchar, text, timestamp, jsonb, index, foreignKey, primaryKey, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const userRole = pgEnum("user_role", ["owner", "admin", "member", "guest"])
export const projectStatus = pgEnum("project_status", ["planning", "active", "on_hold", "completed", "archived"])


export const activityLogs = pgTable("activity_logs", {
	id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
	organizationId: bigint("organization_id", { mode: 'number' }).notNull().references(() => organizations.id, { onDelete: "cascade" } ),
	userId: bigint("user_id", { mode: 'number' }).notNull().references(() => users.id, { onDelete: "cascade" } ),
	action: varchar({ length: 100 }).notNull(),
	entityType: varchar("entity_type", { length: 50 }).notNull(),
	entityId: bigint("entity_id", { mode: 'number' }),
	description: text(),
	metadata: jsonb(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [
	index("activity_logs_entity_idx").using("btree", table.entityType.asc().nullsLast(), table.entityId.asc().nullsLast()),
	index("idx_activity_logs_organization_id").using("btree", table.organizationId.asc().nullsLast()),
]);

export const memberships = pgTable("memberships", {
	id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity().notNull(),
	userRole: userRole("user_role").default("guest").notNull(),
	userId: bigint("user_id", { mode: 'number' }).references(() => users.id),
	organizationId: bigint("organization_id", { mode: 'number' }).notNull().references(() => organizations.id, { onDelete: "cascade" } ),
}, (table) => [
	unique("ck").on(table.userId, table.organizationId),]);

export const organizations = pgTable("organizations", {
	id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
	name: varchar({ length: 100 }).notNull(),
	slug: varchar({ length: 100 }).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => [
	unique("organizations_slug_key").on(table.slug),]);

export const projects = pgTable("projects", {
	id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
	teamId: bigint("team_id", { mode: 'number' }).notNull().references(() => teams.id, { onDelete: "cascade" } ),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	status: projectStatus().default("planning").notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
	archivedAt: timestamp("archived_at"),
}, (table) => [
	unique("projects_team_id_name_key").on(table.teamId, table.name),]);

export const teams = pgTable("teams", {
	id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
	name: varchar({ length: 100 }),
	createdAt: timestamp("created_at").default(sql`now()`),
	organizationId: bigint("organization_id", { mode: 'number' }).references(() => organizations.id),
}, (table) => [
	unique("teams_org_name_unique").on(table.organizationId, table.name),]);

export const users = pgTable("users", {
	id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({ maxValue: 2147483647 }),
	email: varchar({ length: 255 }).notNull(),
	hashedpassword: varchar({ length: 255 }),
	name: varchar({ length: 255 }),
	createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => [
	unique("users_pk_2").on(table.email),]);
