import { eq } from 'drizzle-orm'
import { users, type NewUserRecord, type UserRecord } from '../database/schema'
import { hasDatabaseUrl, useDb } from './db'

export type PublicUser = {
  id: string
  name: string
  email: string
  plan: string
}

type MemoryUser = UserRecord

const globalForUsers = globalThis as typeof globalThis & {
  __mokelayMemoryUsers?: Map<string, MemoryUser>
}

function memoryUsers() {
  if (!globalForUsers.__mokelayMemoryUsers) {
    globalForUsers.__mokelayMemoryUsers = new Map()
  }

  return globalForUsers.__mokelayMemoryUsers
}

export function toPublicUser(user: Pick<UserRecord, 'id' | 'name' | 'email' | 'plan'>): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    plan: user.plan,
  }
}

export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  if (hasDatabaseUrl()) {
    const [user] = await useDb().select().from(users).where(eq(users.email, email)).limit(1)
    return user
  }

  return memoryUsers().get(email)
}

export async function createUser(input: Pick<NewUserRecord, 'name' | 'email' | 'passwordHash'>): Promise<UserRecord> {
  if (hasDatabaseUrl()) {
    const [user] = await useDb()
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
      })
      .returning()

    if (!user) {
      throw new Error('Failed to create user.')
    }

    return user
  }

  const now = new Date()
  const user: MemoryUser = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    passwordHash: input.passwordHash,
    plan: 'free',
    createdAt: now,
    updatedAt: now,
  }

  memoryUsers().set(input.email, user)
  return user
}

export function clearMemoryUsers() {
  memoryUsers().clear()
}
