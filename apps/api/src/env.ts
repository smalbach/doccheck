import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the repository's .env (if any) without overriding variables already set in the shell. */
export function loadEnv() {
  for (const file of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../.env')]) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}
