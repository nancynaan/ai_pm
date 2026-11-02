import { setTimeout as delay } from 'node:timers/promises';

export interface AtlassianCredentials {
  siteUrl: string;
  email: string;
  apiToken: string;
}

export interface AtlassianHttpOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class AtlassianError extends Error {
  override name = 'AtlassianError';
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
  }
}

export type AtlassianHttp = ReturnType<typeof createAtlassianHttp>;

/**
 * Minimal Jira/Confluence Cloud REST client: Basic auth with email + API token, JSON in and out,
 * retries on 429 (honouring Retry-After) and 5xx. The token never appears in errors or logs.
 */
export function createAtlassianHttp(credentials: AtlassianCredentials, options: AtlassianHttpOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? delay;
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const baseUrl = credentials.siteUrl.replace(/\/+$/, '');
  const authorization = `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64')}`;

  async function request<T>(method: string, path: string, { query, body }: RequestOptions = {}): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Authorization: authorization, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return (response.status === 204 ? undefined : await response.json()) as T;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      throw new AtlassianError(
        `${method} ${path} failed with ${response.status}: ${await errorSummary(response)}`,
        response.status,
        path,
      );
    }
  }

  return {
    get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
    post: <T>(path: string, options?: RequestOptions) => request<T>('POST', path, options),
    put: <T>(path: string, options?: RequestOptions) => request<T>('PUT', path, options),
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return Math.min(1000 * 2 ** attempt, 8000);
}

async function errorSummary(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text) as {
      errorMessages?: string[];
      message?: string;
      errors?: Record<string, string>;
    };
    const messages = [...(json.errorMessages ?? []), ...Object.values(json.errors ?? {})];
    if (json.message) messages.push(json.message);
    if (messages.length > 0) return messages.join('; ');
  } catch {
    // not JSON, fall through
  }
  return text.slice(0, 300) || response.statusText;
}
