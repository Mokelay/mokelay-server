import { sql } from 'drizzle-orm'
import { boolean, check, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

export const reimbursementCategories = pgTable('reimbursement_categories', {
  value: varchar('value', { length: 40 }).primaryKey(),
  label: text('label').notNull(),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull(),
})

export const reimbursementApplications = pgTable('reimbursement_applications', {
  id: varchar('id', { length: 19 }).primaryKey(),
  enterpriseUuid: uuid('enterprise_uuid').notNull(),
  employeeId: uuid('employee_id').notNull(),
  version: integer('version').notNull(),
  status: text('status').notNull(),
  showHelp: text('show_help').notNull().default('no'),
  category: varchar('category', { length: 40 }).references(() => reimbursementCategories.value),
  fiat: numeric('fiat', { precision: 16, scale: 2 }).notNull().default('0'),
  crypto: numeric('crypto', { precision: 16, scale: 2 }).notNull().default('0'),
  loan: numeric('loan', { precision: 16, scale: 2 }).notNull().default('0'),
  settlement: numeric('settlement', { precision: 17, scale: 2 }).generatedAlwaysAs(sql`fiat + crypto - loan`),
  note: text('note').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('reimbursement_open_draft').on(table.enterpriseUuid, table.employeeId).where(sql`status = 'draft'`),
  check('reimbursement_state', sql`status = 'draft' OR (status = 'submitted' AND category IS NOT NULL)`),
  check('reimbursement_amounts', sql`fiat >= 0 AND crypto >= 0 AND loan >= 0`),
])

export const reimbursementWriteLocks = pgTable('reimbursement_write_locks', {
  id: varchar('id', { length: 73 }).primaryKey(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
