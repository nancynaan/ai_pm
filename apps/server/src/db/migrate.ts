import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import type { Db } from './client.js';

// apps/server/drizzle, reached the same way from src/ (dev) and dist/ (build).
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

interface WarnLogger {
  warn(obj: object, msg: string): void;
}

/** Postgres may still be starting when the app boots; retry for about 30 seconds. */
export async function waitForDatabase(pool: pg.Pool, log: WarnLogger, attempts = 30, delayMs = 1000) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('select 1');
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      log.warn({ attempt, error: (err as Error).message }, 'database not ready, retrying');
      await sleep(delayMs);
    }
  }
}
