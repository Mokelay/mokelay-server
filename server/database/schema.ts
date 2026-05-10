import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  plan: varchar('plan', { length: 32 }).notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const pages = pgTable('pages', {
  uuid: uuid('uuid').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orchestrationApis = pgTable('orchestration_apis', {
  uuid: varchar('uuid', { length: 128 }).primaryKey(),
  alias: varchar('alias', { length: 255 }).notNull().default(''),
  method: varchar('method', { length: 16 }).notNull().default('GET'),
  draftState: jsonb('draft_state').$type<Record<string, unknown>>().notNull().default({}),
  draftJson: jsonb('draft_json').$type<Record<string, unknown>>().notNull(),
  publishedVersionId: uuid('published_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
})

export const orchestrationApiVersions = pgTable('orchestration_api_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiUuid: varchar('api_uuid', { length: 128 }).notNull(),
  version: integer('version').notNull(),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  builderState: jsonb('builder_state').$type<Record<string, unknown>>().notNull().default({}),
  changeNote: text('change_note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  apiVersionUnique: uniqueIndex('orchestration_api_versions_api_uuid_version_unique').on(table.apiUuid, table.version),
}))

export type UserRecord = typeof users.$inferSelect
export type NewUserRecord = typeof users.$inferInsert
export type PageRecord = typeof pages.$inferSelect
export type NewPageRecord = typeof pages.$inferInsert
export type OrchestrationApiRecord = typeof orchestrationApis.$inferSelect
export type NewOrchestrationApiRecord = typeof orchestrationApis.$inferInsert
export type OrchestrationApiVersionRecord = typeof orchestrationApiVersions.$inferSelect
export type NewOrchestrationApiVersionRecord = typeof orchestrationApiVersions.$inferInsert
