import { z } from 'zod';

export const RoleSchema = z.enum(['owner', 'reader']);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  github: z.string().nullable(),
  email: z.string().nullable(),
  role: RoleSchema,
  createdAt: z.number(),
});
export type User = z.infer<typeof UserSchema>;
