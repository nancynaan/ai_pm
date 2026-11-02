// Applies database migrations without starting the server: npm run db:migrate
import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations, waitForDatabase } from './migrate.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const log = { warn: (obj: object, msg: string) => console.warn(msg, obj) };

try {
  await waitForDatabase(pool, log);
  await runMigrations(db);
  console.log('Migrations applied.');
} finally {
  await pool.end();
}
