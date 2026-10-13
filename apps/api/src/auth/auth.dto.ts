import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));
const password = z.string().min(8, 'Use at least 8 characters').max(200, 'Use at most 200 characters');
const name = z.string().trim().min(1, 'Enter your name').max(100);

export const RegisterDto = z.object({ email, password, name });
export type RegisterDto = z.infer<typeof RegisterDto>;

export const LoginDto = z.object({ email, password: z.string().min(1).max(200) });
export type LoginDto = z.infer<typeof LoginDto>;

export const UpdateProfileDto = z.object({ name });
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;

export const ChangePasswordDto = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });
export type ChangePasswordDto = z.infer<typeof ChangePasswordDto>;

export const ResetPasswordDto = z.object({ newPassword: password });
export type ResetPasswordDto = z.infer<typeof ResetPasswordDto>;

export const DeleteAccountDto = z.object({ password: z.string().min(1).max(200) });
export type DeleteAccountDto = z.infer<typeof DeleteAccountDto>;
