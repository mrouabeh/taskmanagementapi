import { z } from 'zod'

export const registerUserSchema = z.object({
  name: z
    .string()
    .min(1, { message: 'Name is required' })
    .max(49, { message: 'Name must be less than 50 characters' }),
  email: z.string().email({ message: 'Invalid email' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long' })
    .max(100, { message: 'Password is too long' }),
})
export const loginUserSchema = z.object({
  email: z.string().email({ message: 'Invalid email' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long' })
    .max(100, { message: 'Password is too long' }),
})
export const forgotPasswordSchema = z.object({
  email: z.string().email({ message: 'Invalid email' }),
})

export const resetPasswordSchema = z.object({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, { message: 'Invalid token' })
    .min(20, { message: 'Invalid token' })
    .max(200, { message: 'Invalid token' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long' })
    .max(100, { message: 'Password is too long' }),
})

export type forgotPasswordZ = z.infer<typeof forgotPasswordSchema>
export type resetPasswordZ = z.infer<typeof resetPasswordSchema>
export type registerUserZ = z.infer<typeof registerUserSchema>
export type loginUserZ = z.infer<typeof loginUserSchema>
