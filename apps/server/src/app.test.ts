import { healthReportSchema } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { failed, type HealthProbe, notConfigured, ok } from './health/probe.js';

const probe = (name: string, result: Awaited<ReturnType<HealthProbe['run']>>): HealthProbe => ({
  name,
  label: name,
  run: async () => result,
});

async function getHealth(probes: HealthProbe[]) {
  const app = await buildApp({ logger: false, probes, version: '0.0.0-test' });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  await app.close();
  return { status: response.statusCode, body: healthReportSchema.parse(response.json()) };
}

describe('health API', () => {
  it('answers the liveness probe without running checks', async () => {
    const app = await buildApp({ logger: false, probes: [probe('db', failed('down'))], version: '0' });
    const response = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('is ok when every check passes', async () => {
    const { status, body } = await getHealth([probe('db', ok('fine')), probe('jira', ok('fine'))]);
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks).toHaveLength(2);
  });

  it('is degraded but still 200 while credentials are missing', async () => {
    const { status, body } = await getHealth([
      probe('db', ok('fine')),
      probe('jira', notConfigured('no token')),
    ]);
    expect(status).toBe(200);
    expect(body.status).toBe('degraded');
  });

  it('returns 503 when a check fails', async () => {
    const { status, body } = await getHealth([
      probe('db', failed('down')),
      probe('jira', notConfigured('no token')),
    ]);
    expect(status).toBe(503);
    expect(body.status).toBe('error');
  });
});
