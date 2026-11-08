import { z } from 'zod';

export const appRoleSchema = z.enum(['citizen', 'moderator', 'admin']);
export type AppRole = z.infer<typeof appRoleSchema>;
export const DEFAULT_APP_ROLE: AppRole = 'citizen';
