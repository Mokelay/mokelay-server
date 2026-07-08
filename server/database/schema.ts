import { sql } from 'drizzle-orm'
import { bigserial, boolean, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

export const enterprise = pgTable('enterprise', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().defaultRandom().unique(),
  name: varchar('name', { length: 120 }).notNull(),
})

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  enterpriseUuid: uuid('enterprise_uuid').notNull().references(() => enterprise.uuid),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  plan: varchar('plan', { length: 32 }).notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const employeeAuthIdentities = pgTable('employee_auth_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  provider: varchar('provider', { length: 32 }).notNull(),
  providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
  providerEmail: varchar('provider_email', { length: 255 }).notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('employee_auth_identity_provider_user_unique').on(table.provider, table.providerUserId),
  uniqueIndex('employee_auth_identity_provider_employee_unique').on(table.provider, table.employeeId),
])

export const pages = pgTable('pages', {
  uuid: uuid('uuid').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
  appUuid: varchar('app_uuid', { length: 8 }),
  layoutUuid: varchar('layout_uuid', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apps = pgTable('apps', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 8 }).notNull().unique(),
  alias: varchar('alias', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
  defaultLayoutUuid: varchar('default_layout_uuid', { length: 128 }),
})

export const layouts = pgTable('layouts', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  layoutJson: jsonb('layout_json').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const datasources = pgTable('datasources', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 8 }).notNull().unique(),
  alias: varchar('alias', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
  schemaData: jsonb('schema_data').$type<unknown[]>().notNull().default([]),
})

export const apiDomains = pgTable('api_domains', {
  uuid: varchar('uuid', { length: 128 }).primaryKey(),
  alias: varchar('alias', { length: 120 }).notNull(),
  host: text('host').notNull().unique(),
})

export const apis = pgTable('apis', {
  uuid: varchar('uuid', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('draft'),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  layout: jsonb('layout').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apisSnapshot = pgTable('apis_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiUuid: varchar('api_uuid', { length: 128 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const blockComponentDocs = pgTable('block_component_docs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  blockType: varchar('block_type', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  category: varchar('category', { length: 64 }).notNull().default('custom'),
  sourceKind: varchar('source_kind', { length: 64 }).notNull().default('mokelay-editor'),
  sourceFile: text('source_file').notNull().default(''),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  toolbox: jsonb('toolbox').$type<Record<string, unknown>>().notNull().default({}),
  initialProps: jsonb('initial_props').$type<Record<string, unknown>>().notNull().default({}),
  propertySchema: jsonb('property_schema').$type<unknown[]>().notNull().default([]),
  eventSchema: jsonb('event_schema').$type<unknown[]>().notNull().default([]),
  methodSchema: jsonb('method_schema').$type<unknown[]>().notNull().default([]),
  dataFieldsSchema: jsonb('data_fields_schema').$type<unknown[]>().notNull().default([]),
  examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
  sourceRefs: jsonb('source_refs').$type<unknown[]>().notNull().default([]),
  rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type EnterpriseRecord = typeof enterprise.$inferSelect
export type NewEnterpriseRecord = typeof enterprise.$inferInsert
export type EmployeeRecord = typeof employees.$inferSelect
export type NewEmployeeRecord = typeof employees.$inferInsert
export type EmployeeAuthIdentityRecord = typeof employeeAuthIdentities.$inferSelect
export type NewEmployeeAuthIdentityRecord = typeof employeeAuthIdentities.$inferInsert
export type PageRecord = typeof pages.$inferSelect
export type NewPageRecord = typeof pages.$inferInsert
export type AppRecord = typeof apps.$inferSelect
export type NewAppRecord = typeof apps.$inferInsert
export type LayoutRecord = typeof layouts.$inferSelect
export type NewLayoutRecord = typeof layouts.$inferInsert
export type DatasourceRecord = typeof datasources.$inferSelect
export type NewDatasourceRecord = typeof datasources.$inferInsert
export type ApiDomainRecord = typeof apiDomains.$inferSelect
export type NewApiDomainRecord = typeof apiDomains.$inferInsert
export type ApiRecord = typeof apis.$inferSelect
export type NewApiRecord = typeof apis.$inferInsert
export type ApiSnapshotRecord = typeof apisSnapshot.$inferSelect
export type NewApiSnapshotRecord = typeof apisSnapshot.$inferInsert
export type BlockComponentDocRecord = typeof blockComponentDocs.$inferSelect
export type NewBlockComponentDocRecord = typeof blockComponentDocs.$inferInsert
