// Seeds the demo project's baseline into Jira, Confluence and the database.
//
//   node apps/server/dist/baseline/cli.js              dry-run (or whatever ATLASSIAN_WRITE_MODE says)
//   node apps/server/dist/baseline/cli.js --live       write to Jira and Confluence
//   node apps/server/dist/baseline/cli.js --sync-only  re-read the pages from Confluence into the database
import { type AppConfig, atlassianCredentials, ConfigError, loadConfig, type WriteMode } from '../config.js';
import { createDb } from '../db/client.js';
import { runMigrations, waitForDatabase } from '../db/migrate.js';
import { createAtlassianGateway } from '../integrations/atlassian/index.js';
import type { SyncAction, SyncResult } from '../sync/publisher.js';
import { drizzleSyncLog } from '../sync/sync-log.js';
import { buildPages } from './pages.js';
import { renderPage, runSeed, type SeedReport } from './seed.js';
import { loadSeedData } from './seed-data.js';
import { loadBaseline } from './store.js';

const SYMBOL: Record<SyncAction, string> = {
  created: '+',
  updated: '~',
  unchanged: '=',
  'would create': '+?',
  'would update': '~?',
};

function printReport(report: SeedReport) {
  const sections: [SyncResult['kind'], string][] = [
    ['field', 'Custom field'],
    ['component', 'Components'],
    ['issue', 'Epics and stories'],
    ['page', 'Confluence pages'],
  ];
  for (const [kind, heading] of sections) {
    const rows = report.results.filter((r) => r.kind === kind);
    if (rows.length === 0) continue;
    console.log(`\n${heading}`);
    for (const r of rows) {
      const where = r.url ?? r.externalId;
      console.log(
        `  ${SYMBOL[r.action].padEnd(3)}${r.label}  [${r.action}]  ${where}${r.note ? `  (${r.note})` : ''}`,
      );
    }
  }
  const moves = report.statusChanges.filter((s) => s.result !== 'unchanged');
  if (moves.length > 0) {
    console.log(`\nStatus changes: ${moves.map((s) => `${s.issue} ${s.result}`).join(', ')}`);
  }
  const counts = new Map<string, number>();
  for (const r of report.results) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
  console.log(`\nSummary: ${[...counts].map(([a, n]) => `${n} ${a}`).join(', ')}`);
  console.log(
    `Database: ${report.baseline.artifacts} baseline artifacts (${report.baseline.fromConfluence} read from Confluence), digest of ${report.baseline.digestLines} lines.`,
  );
  if (report.mode === 'dry-run') {
    console.log('\nDRY-RUN: nothing was written to Jira or Confluence. Run again with --live to write.');
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const config: AppConfig = loadConfig();
  const syncOnly = args.has('--sync-only');
  const mode: WriteMode = args.has('--live') ? 'live' : config.atlassian.writeMode;
  const credentials = atlassianCredentials(config);
  if (!credentials)
    throw new ConfigError('Set ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN in .env');

  const { db, pool } = createDb(config.databaseUrl);
  try {
    await waitForDatabase(pool, { warn: (_obj, msg) => console.warn(msg) });
    await runMigrations(db);
    const gateway = createAtlassianGateway(credentials, { readOnly: syncOnly || mode === 'dry-run' });
    const store = drizzleSyncLog(db);
    const seed = loadSeedData();

    if (syncOnly) {
      // Issue keys only feed page text, which is re-read from Confluence anyway.
      const pages = buildPages(seed, { issueKeys: new Map() }).map(renderPage);
      const baseline = await loadBaseline({ db, config, gateway, store, seed, pages });
      console.log(
        `Baseline re-read: ${baseline.fromConfluence} of ${baseline.artifacts} pages from Confluence.`,
      );
      return;
    }

    console.log(`Seeding ${seed.project.name} into ${config.atlassian.siteUrl} (${mode.toUpperCase()})`);
    const report = await runSeed({
      config,
      gateway,
      store,
      db,
      seed,
      mode,
      log: (m) => console.log(`- ${m}`),
    });
    printReport(report);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    err instanceof Error ? `\n${err.name === 'Error' ? '' : `${err.name}: `}${err.message}` : err,
  );
  process.exit(1);
});
