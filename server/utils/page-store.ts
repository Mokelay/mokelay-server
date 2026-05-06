import { count, desc, eq } from 'drizzle-orm'
import { pages, type PageRecord } from '../database/schema'
import { hasDatabaseUrl, useDb } from './db'

export type PublicPage = {
  uuid: string
  name: string
  blocks: unknown[]
  createdAt: string
  updatedAt: string
}

type MemoryPage = PageRecord

type ListPagesInput = {
  page: number
  pageSize: number
}

type ListPagesResult = {
  pages: PageRecord[]
  total: number
}

const globalForPages = globalThis as typeof globalThis & {
  __mokelayMemoryPages?: Map<string, MemoryPage>
}

function memoryPages() {
  if (!globalForPages.__mokelayMemoryPages) {
    globalForPages.__mokelayMemoryPages = new Map()
  }

  return globalForPages.__mokelayMemoryPages
}

export function toPublicPage(page: PageRecord): PublicPage {
  return {
    uuid: page.uuid,
    name: page.name,
    blocks: page.blocks,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }
}

export async function createPage(input: { name: string, blocks: unknown[] }): Promise<PageRecord> {
  if (hasDatabaseUrl()) {
    const [page] = await useDb()
      .insert(pages)
      .values({
        name: input.name,
        blocks: input.blocks,
      })
      .returning()

    if (!page) {
      throw new Error('Failed to create page.')
    }

    return page
  }

  const now = new Date()
  const page: MemoryPage = {
    uuid: crypto.randomUUID(),
    name: input.name,
    blocks: input.blocks,
    createdAt: now,
    updatedAt: now,
  }

  memoryPages().set(page.uuid, page)
  return page
}

export async function findPageByUuid(uuid: string): Promise<PageRecord | undefined> {
  if (hasDatabaseUrl()) {
    const [page] = await useDb().select().from(pages).where(eq(pages.uuid, uuid)).limit(1)
    return page
  }

  return memoryPages().get(uuid)
}

export async function listPages(input: ListPagesInput): Promise<ListPagesResult> {
  const offset = (input.page - 1) * input.pageSize

  if (hasDatabaseUrl()) {
    const db = useDb()
    const [pageRows, totalRows] = await Promise.all([
      db
        .select()
        .from(pages)
        .orderBy(desc(pages.updatedAt), desc(pages.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      db.select({ total: count() }).from(pages),
    ])
    const total = totalRows[0]?.total ?? 0

    return {
      pages: pageRows,
      total,
    }
  }

  const sortedPages = Array.from(memoryPages().values()).sort((firstPage, secondPage) => (
    secondPage.updatedAt.getTime() - firstPage.updatedAt.getTime()
    || secondPage.createdAt.getTime() - firstPage.createdAt.getTime()
  ))

  return {
    pages: sortedPages.slice(offset, offset + input.pageSize),
    total: sortedPages.length,
  }
}

export async function updatePageBlocks(uuid: string, blocks: unknown[]): Promise<PageRecord | undefined> {
  if (hasDatabaseUrl()) {
    const [page] = await useDb()
      .update(pages)
      .set({
        blocks,
        updatedAt: new Date(),
      })
      .where(eq(pages.uuid, uuid))
      .returning()

    return page
  }

  const existingPage = memoryPages().get(uuid)

  if (!existingPage) {
    return undefined
  }

  const updatedPage: MemoryPage = {
    ...existingPage,
    blocks,
    updatedAt: new Date(Math.max(Date.now(), existingPage.updatedAt.getTime() + 1)),
  }

  memoryPages().set(uuid, updatedPage)
  return updatedPage
}

export function clearMemoryPages() {
  memoryPages().clear()
}
