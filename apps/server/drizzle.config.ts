import { defineConfig } from 'drizzle-kit';

// Same rule as src/db/url.ts: DATABASE_URL wins, otherwise build it from the POSTGRES_* variables.
const env = process.env;
const url =
  env.DATABASE_URL ||
  `postgres://${env.POSTGRES_USER || 'aipm'}:${env.POSTGRES_PASSWORD ?? ''}@${env.POSTGRES_HOST || 'localhost'}:${env.POSTGRES_PORT || '5432'}/${env.POSTGRES_DB || 'aipm'}`;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
});
