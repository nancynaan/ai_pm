/**
 * DATABASE_URL wins. Otherwise the URL is built from the POSTGRES_* variables that Docker Compose
 * also uses, so the password lives in one place. POSTGRES_HOST defaults to localhost (dev on the
 * host); Compose sets it to the `postgres` service for the app container.
 */
export function databaseUrlFromEnv(env: Record<string, string | undefined>): string {
  const explicit = env.DATABASE_URL?.trim();
  if (explicit) return explicit;
  const part = (name: string, fallback: string) => env[name]?.trim() || fallback;
  const user = encodeURIComponent(part('POSTGRES_USER', 'aipm'));
  const password = encodeURIComponent(env.POSTGRES_PASSWORD?.trim() ?? '');
  const database = encodeURIComponent(part('POSTGRES_DB', 'aipm'));
  return `postgres://${user}:${password}@${part('POSTGRES_HOST', 'localhost')}:${part('POSTGRES_PORT', '5432')}/${database}`;
}
