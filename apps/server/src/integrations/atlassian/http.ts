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
  /** Dry-run safety net: refuse every request that could change data on the site. */
  readOnly?: boolean;
}

/** POST endpoints that only read. */
const READ_ONLY_POSTS = new Set(['/rest/api/3/search/jql']);

export class ReadOnlyViolation extends Error {
  override name = 'ReadOnlyViolation';
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Multipart upload (Confluence attachments); sent as is, with the XSRF bypass header. */
  form?: FormData;
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

  async function request<T>(
    method: string,
    path: string,
    { query, body, form }: RequestOptions = {},
  ): Promise<T> {
    if (options.readOnly && method !== 'GET' && !(method === 'POST' && READ_ONLY_POSTS.has(path))) {
      throw new ReadOnlyViolation(`Blocked ${method} ${path}: Atlassian writes are in dry-run mode`);
    }
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Authorization: authorization, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (form) headers['X-Atlassian-Token'] = 'no-check';

    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        // Several write endpoints answer 200/201/204 with an empty body.
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
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
    siteUrl: baseUrl,
    readOnly: options.readOnly ?? false,
    get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
    post: <T>(path: string, options?: RequestOptions) => request<T>('POST', path, options),
    put: <T>(path: string, options?: RequestOptions) => request<T>('PUT', path, options),
    delete: <T>(path: string) => request<T>('DELETE', path),
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
