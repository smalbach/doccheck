import { z } from 'zod';

export const UpdateSettingsDto = z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateSettingsDto = z.infer<typeof UpdateSettingsDto>;

export { ResetPasswordDto } from '../auth/auth.dto';

export const SetRoleDto = z.object({ role: z.enum(['user', 'admin']) });
export type SetRoleDto = z.infer<typeof SetRoleDto>;
