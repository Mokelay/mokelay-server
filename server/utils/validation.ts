import { z } from 'zod'

export const emailSchema = z
  .string()
  .trim()
  .email('请输入有效邮箱。')
  .max(255, '邮箱长度不能超过 255 个字符。')
  .transform((email) => email.toLowerCase())

export const passwordSchema = z
  .string()
  .min(8, '密码至少需要 8 位。')
  .max(128, '密码不能超过 128 位。')
  .regex(/[A-Za-z]/, '密码至少需要包含一个字母。')
  .regex(/[0-9]/, '密码至少需要包含一个数字。')

export const registerSchema = z.object({
  name: z.string().trim().min(1, '请输入姓名。').max(120, '姓名不能超过 120 个字符。'),
  email: emailSchema,
  password: passwordSchema,
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '请输入密码。'),
})

export const pageUuidSchema = z.string().uuid('页面 UUID 无效。')

export const pageBlocksSchema = z.array(z.unknown(), {
  invalid_type_error: '页面区块必须是数组。',
})

export const createPageSchema = z.object({
  name: z.string().trim().min(1, '请输入页面名称。').max(120, '页面名称不能超过 120 个字符。'),
  blocks: pageBlocksSchema.default([]),
})

export const updatePageBlocksSchema = z.object({
  blocks: pageBlocksSchema,
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type CreatePageInput = z.infer<typeof createPageSchema>
export type UpdatePageBlocksInput = z.infer<typeof updatePageBlocksSchema>

export function formatValidationError(error: z.ZodError) {
  return error.issues[0]?.message || '输入内容无效。'
}
