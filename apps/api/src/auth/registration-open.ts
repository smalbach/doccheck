/** Whether anyone may sign up (REGISTRATION_OPEN, changed by admins from Settings). Admins listed in ADMIN_EMAILS always may. */
export function registrationOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REGISTRATION_OPEN !== 'false';
}
