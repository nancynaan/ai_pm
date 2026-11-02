import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyServerOptions } from 'fastify';
import { buildApp } from './app.js';
import { type AppConfig, atlassianCredentials, ConfigError, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations, waitForDatabase } from './db/migrate.js';
import { buildProbes } from './health/checks.js';
import { createAtlassianGateway } from './integrations/atlassian/index.js';
import { createClaudeCli } from './integrations/claude-cli.js';
import { createMailer } from './integrations/mailer.js';

function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

async function main() {
  const config = loadConfig();
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

  const { db, pool } = createDb(config.databaseUrl);
  const credentials = atlassianCredentials(config);
  const probes = buildProbes({
    config,
    query: (sql) => pool.query(sql),
    atlassian: credentials && createAtlassianGateway(credentials),
    claude: createClaudeCli({ cliPath: config.claude.cliPath }),
    mailer: createMailer(config.smtp),
  });

  const app = await buildApp({
    logger: loggerOptions(config),
    probes,
    version: pkg.version,
    webDistDir: existsSync(webDistDir) ? webDistDir : undefined,
  });

  await waitForDatabase(pool, app.log);
  await runMigrations(db);
  app.log.info('database migrations applied');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.port });
  app.log.info(
    {
      atlassian: credentials ? config.atlassian.siteUrl : 'not configured',
      writeMode: config.atlassian.writeMode,
      claude: `${config.claude.cliPath} (${config.claude.model})`,
      smtp: config.smtp.usingMailpit ? 'mailpit' : config.smtp.host,
    },
    `AI PM server ${pkg.version} ready at ${config.baseUrl}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
