import { describe, expect, it, vi } from 'vitest';
import { AtlassianError, createAtlassianHttp } from './http.js';

const credentials = {
  siteUrl: 'https://demo.atlassian.net/',
  email: 'pm@example.com',
  apiToken: 'secret-token',
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('createAtlassianHttp', () => {
  it('sends Basic auth and query parameters', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    const http = createAtlassianHttp(credentials, { fetch });

    await http.get('/wiki/api/v2/spaces', { query: { keys: 'ERG', limit: undefined } });

    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://demo.atlassian.net/wiki/api/v2/spaces?keys=ERG');
    const expected = `Basic ${Buffer.from('pm@example.com:secret-token').toString('base64')}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(expected);
  });

  it('retries a 429 after the Retry-After delay', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { displayName: 'PM' }));
    const sleep = vi.fn(async () => undefined);
    const http = createAtlassianHttp(credentials, { fetch, sleep });

    await expect(http.get('/rest/api/3/myself')).resolves.toEqual({ displayName: 'PM' });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries on repeated 5xx', async () => {
    const fetch = vi.fn(async () => jsonResponse(503, { message: 'down' }));
    const http = createAtlassianHttp(credentials, { fetch, sleep: async () => undefined, maxRetries: 2 });

    await expect(http.get('/rest/api/3/myself')).rejects.toThrow(/503: down/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 401 and keeps the token out of the error', async () => {
    const fetch = vi.fn(async () => jsonResponse(401, { errorMessages: ['Client must be authenticated'] }));
    const http = createAtlassianHttp(credentials, { fetch });

    const error = await http.get('/rest/api/3/myself').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AtlassianError);
    expect((error as AtlassianError).status).toBe(401);
    expect((error as Error).message).toContain('Client must be authenticated');
    expect((error as Error).message).not.toContain('secret-token');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
