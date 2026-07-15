import { sql } from 'drizzle-orm'
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

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
  uuid: varchar('uuid', { length: 128 }).primaryKey().default(sql`gen_random_uuid()::text`),
  name: varchar('name', { length: 120 }).notNull(),
  blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
  subPage: boolean('sub_page').notNull().default(false),
  quotes: jsonb('quotes').$type<string[]>().notNull().default([]),
  dependencies: jsonb('dependencies').$type<string[]>().notNull().default([]),
  appUuid: varchar('app_uuid', { length: 8 }),
  layoutUuid: varchar('layout_uuid', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_pages_sub_page').on(table.subPage),
  check(
    'pages_uuid_slug_check',
    sql`char_length(${table.uuid}) BETWEEN 1 AND 128 AND ${table.uuid} !~ '[^a-z0-9_-]'`,
  ),
])

export const pageReferenceGraphState = pgTable('page_reference_graph_state', {
  id: integer('id').primaryKey().notNull().default(1),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  version: integer('version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('page_reference_graph_state_singleton', sql`${table.id} = 1`),
])

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
  enterpriseUuid: uuid('enterprise_uuid').references(() => enterprise.uuid, { onDelete: 'set null' }),
  schemaData: jsonb('schema_data').$type<unknown[]>().notNull().default([]),
}, (table) => [
  index('idx_datasources_enterprise_uuid').on(table.enterpriseUuid),
])

export const apiDomains = pgTable('api_domains', {
  uuid: varchar('uuid', { length: 128 }).primaryKey(),
  alias: varchar('alias', { length: 120 }).notNull(),
  host: text('host').notNull().unique(),
})

export const apis = pgTable('apis', {
  uuid: varchar('uuid', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  fragment: boolean('fragment').notNull().default(false),
  status: varchar('status', { length: 32 }).notNull().default('draft'),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  layout: jsonb('layout').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_apis_fragment_status').on(table.fragment, table.status),
])

export const apisSnapshot = pgTable('apis_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiUuid: varchar('api_uuid', { length: 128 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  fragment: boolean('fragment').notNull().default(false),
  status: varchar('status', { length: 32 }).notNull(),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apiBuilderSamples = pgTable('api_builder_samples', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  title: varchar('title', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
  method: varchar('method', { length: 16 }).notNull(),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const blockComponentDocs = pgTable('docs_client_block', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  blockType: varchar('block_type', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  category: varchar('category', { length: 64 }).notNull().default('custom'),
  sourceKind: varchar('source_kind', { length: 64 }).notNull().default('mokelay-editor'),
  sourcePackage: varchar('source_package', { length: 128 }).notNull().default('mokelay-editor'),
  sourceFile: text('source_file').notNull().default(''),
  componentName: varchar('component_name', { length: 128 }).notNull().default(''),
  toolSymbol: varchar('tool_symbol', { length: 128 }).notNull().default(''),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  editorEnabled: boolean('editor_enabled').notNull().default(true),
  toolboxVisible: boolean('toolbox_visible').notNull().default(true),
  editorBlock: boolean('editor_block').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  registration: jsonb('registration').$type<Record<string, unknown>>().notNull().default({}),
  toolbox: jsonb('toolbox').$type<Record<string, unknown>>().notNull().default({}),
  initialProps: jsonb('initial_props').$type<Record<string, unknown>>().notNull().default({}),
  defaultData: jsonb('default_data').$type<Record<string, unknown>>().notNull().default({}),
  propertySchema: jsonb('property_schema').$type<unknown[]>().notNull().default([]),
  eventSchema: jsonb('event_schema').$type<unknown[]>().notNull().default([]),
  methodSchema: jsonb('method_schema').$type<unknown[]>().notNull().default([]),
  dataFieldsSchema: jsonb('data_fields_schema').$type<unknown[]>().notNull().default([]),
  saveSchema: jsonb('save_schema').$type<unknown[]>().notNull().default([]),
  examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
  sourceRefs: jsonb('source_refs').$type<unknown[]>().notNull().default([]),
  rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_docs_client_block_category').on(table.category),
  index('idx_docs_client_block_source_kind').on(table.sourceKind),
  index('idx_docs_client_block_editor_enabled').on(table.editorEnabled),
  index('idx_docs_client_block_toolbox_visible').on(table.toolboxVisible),
  index('idx_docs_client_block_editor_block').on(table.editorBlock),
])

export const serverBlockDocs = pgTable('docs_server_block', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  functionName: varchar('function_name', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  category: varchar('category', { length: 64 }).notNull().default('custom'),
  sourceKind: varchar('source_kind', { length: 64 }).notNull(),
  sourcePackage: varchar('source_package', { length: 128 }).notNull(),
  sourceFile: text('source_file').notNull().default(''),
  executorName: varchar('executor_name', { length: 128 }).notNull(),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  requiresDatasource: boolean('requires_datasource').notNull().default(false),
  inputSchema: jsonb('input_schema').$type<unknown[]>().notNull().default([]),
  outputSchema: jsonb('output_schema').$type<unknown[]>().notNull().default([]),
  errorSchema: jsonb('error_schema').$type<unknown[]>().notNull().default([]),
  configSchema: jsonb('config_schema').$type<unknown[]>().notNull().default([]),
  runtimeSchema: jsonb('runtime_schema').$type<unknown[]>().notNull().default([]),
  examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
  sourceRefs: jsonb('source_refs').$type<unknown[]>().notNull().default([]),
  rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_docs_server_block_category').on(table.category),
  index('idx_docs_server_block_source_kind').on(table.sourceKind),
  index('idx_docs_server_block_requires_datasource').on(table.requiresDatasource),
])

export const serverControllerDocs = pgTable('docs_server_controller', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  functionName: varchar('function_name', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  category: varchar('category', { length: 64 }).notNull().default('custom'),
  sourceKind: varchar('source_kind', { length: 64 }).notNull(),
  sourcePackage: varchar('source_package', { length: 128 }).notNull(),
  sourceFile: text('source_file').notNull().default(''),
  executorName: varchar('executor_name', { length: 128 }).notNull(),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  inputSchema: jsonb('input_schema').$type<unknown[]>().notNull().default([]),
  nodeSchema: jsonb('node_schema').$type<unknown[]>().notNull().default([]),
  errorSchema: jsonb('error_schema').$type<unknown[]>().notNull().default([]),
  configSchema: jsonb('config_schema').$type<unknown[]>().notNull().default([]),
  runtimeSchema: jsonb('runtime_schema').$type<unknown[]>().notNull().default([]),
  examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
  sourceRefs: jsonb('source_refs').$type<unknown[]>().notNull().default([]),
  rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_docs_server_controller_category').on(table.category),
  index('idx_docs_server_controller_source_kind').on(table.sourceKind),
])

export const serverProcessorDocs = pgTable('docs_server_processor', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  functionName: varchar('function_name', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  category: varchar('category', { length: 64 }).notNull().default('custom'),
  sourceKind: varchar('source_kind', { length: 64 }).notNull(),
  sourcePackage: varchar('source_package', { length: 128 }).notNull(),
  sourceFile: text('source_file').notNull().default(''),
  executorName: varchar('executor_name', { length: 128 }).notNull(),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  inputSchema: jsonb('input_schema').$type<unknown[]>().notNull().default([]),
  paramSchema: jsonb('param_schema').$type<unknown[]>().notNull().default([]),
  outputSchema: jsonb('output_schema').$type<unknown[]>().notNull().default([]),
  errorSchema: jsonb('error_schema').$type<unknown[]>().notNull().default([]),
  configSchema: jsonb('config_schema').$type<unknown[]>().notNull().default([]),
  runtimeSchema: jsonb('runtime_schema').$type<unknown[]>().notNull().default([]),
  examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
  sourceRefs: jsonb('source_refs').$type<unknown[]>().notNull().default([]),
  rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_docs_server_processor_category').on(table.category),
  index('idx_docs_server_processor_source_kind').on(table.sourceKind),
])

export const clientActionDocs = pgTable('docs_client_action', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  actionName: varchar('action_name', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  actionType: varchar('action_type', { length: 32 }).notNull().default('action'),
  category: varchar('category', { length: 64 }).notNull().default('custom'),
  sourceKind: varchar('source_kind', { length: 64 }).notNull(),
  sourcePackage: varchar('source_package', { length: 128 }).notNull(),
  sourceFile: text('source_file').notNull().default(''),
  executorName: varchar('executor_name', { length: 128 }).notNull(),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  inputSchema: jsonb('input_schema').$type<unknown[]>().notNull().default([]),
  outputSchema: jsonb('output_schema').$type<unknown[]>().notNull().default([]),
  errorSchema: jsonb('error_schema').$type<unknown[]>().notNull().default([]),
  configSchema: jsonb('config_schema').$type<unknown[]>().notNull().default([]),
  nodeSchema: jsonb('node_schema').$type<unknown[]>().notNull().default([]),
  runtimeSchema: jsonb('runtime_schema').$type<unknown[]>().notNull().default([]),
  examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
  sourceRefs: jsonb('source_refs').$type<unknown[]>().notNull().default([]),
  rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_docs_client_action_category').on(table.category),
  index('idx_docs_client_action_source_kind').on(table.sourceKind),
])

export const clientProcessorDocs = pgTable('docs_client_processor', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  uuid: varchar('uuid', { length: 128 }).notNull().unique(),
  processorName: varchar('processor_name', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  category: varchar('category', { length: 64 }).notNull().default('custom'),
  sourceKind: varchar('source_kind', { length: 64 }).notNull(),
  sourcePackage: varchar('source_package', { length: 128 }).notNull(),
  sourceFile: text('source_file').notNull().default(''),
  executorName: varchar('executor_name', { length: 128 }).notNull(),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  inputSchema: jsonb('input_schema').$type<unknown[]>().notNull().default([]),
  paramSchema: jsonb('param_schema').$type<unknown[]>().notNull().default([]),
  outputSchema: jsonb('output_schema').$type<unknown[]>().notNull().default([]),
  errorSchema: jsonb('error_schema').$type<unknown[]>().notNull().default([]),
  configSchema: jsonb('config_schema').$type<unknown[]>().notNull().default([]),
  runtimeSchema: jsonb('runtime_schema').$type<unknown[]>().notNull().default([]),
  examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
  sourceRefs: jsonb('source_refs').$type<unknown[]>().notNull().default([]),
  rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_docs_client_processor_category').on(table.category),
  index('idx_docs_client_processor_source_kind').on(table.sourceKind),
])

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
export type ApiBuilderSampleRecord = typeof apiBuilderSamples.$inferSelect
export type NewApiBuilderSampleRecord = typeof apiBuilderSamples.$inferInsert
export type BlockComponentDocRecord = typeof blockComponentDocs.$inferSelect
export type NewBlockComponentDocRecord = typeof blockComponentDocs.$inferInsert
export type ServerBlockDocRecord = typeof serverBlockDocs.$inferSelect
export type NewServerBlockDocRecord = typeof serverBlockDocs.$inferInsert
export type ServerControllerDocRecord = typeof serverControllerDocs.$inferSelect
export type NewServerControllerDocRecord = typeof serverControllerDocs.$inferInsert
export type ServerProcessorDocRecord = typeof serverProcessorDocs.$inferSelect
export type NewServerProcessorDocRecord = typeof serverProcessorDocs.$inferInsert
export type ClientActionDocRecord = typeof clientActionDocs.$inferSelect
export type NewClientActionDocRecord = typeof clientActionDocs.$inferInsert
export type ClientProcessorDocRecord = typeof clientProcessorDocs.$inferSelect
export type NewClientProcessorDocRecord = typeof clientProcessorDocs.$inferInsert
