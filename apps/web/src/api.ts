import type { z } from 'zod';

/** fetch + JSON + schema check; server errors ({ error }) become thrown messages. */
export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return schema.parse(body);
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
