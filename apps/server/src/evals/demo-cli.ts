// Demo runs: plays the client of sample features through the app's own API, so each feature gets
// a real, saved run (chat history, discovery report, analysis, assessment on the Analysis tab).
// Answers come from the feature's profile in evals/features.yaml; feature-specific and
// clarification questions get their first definite option; an incomplete discovery is accepted
// as a preliminary assessment, and the documents are published with the button (dry-run unless
// ATLASSIAN_WRITE_MODE=live). The run stops at the client's decision gate.
//
//   docker compose exec app node apps/server/dist/evals/demo-cli.js --only rewarded-menu-chest
import { setTimeout as sleep } from 'node:timers/promises';
import {
  type Assessment,
  assessmentSchema,
  type RunSummary,
  runSummarySchema,
} from '@ai-pm/shared';
import { z } from 'zod';
import { answersFor, type EvalFeature, loadEvalFeatures, onlyArg } from './features.js';

const BASE_URL = process.env.DEMO_BASE_URL ?? `http://localhost:${process.env.APP_PORT ?? 3000}`;
const TIMEOUT_MS = 40 * 60_000;
const STOP_STATES = new Set(['awaiting_decision', 'completed', 'declined', 'failed']);

async function call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`);
  return schema.parse(JSON.parse(text));
}

async function demo(feature: EvalFeature): Promise<{ run: RunSummary; assessment: Assessment | null }> {
  const { runId } = await call('/api/runs', z.object({ runId: z.string() }), {
    description: feature.description,
  });
  console.log(`  run ${runId}`);
  const answered = new Set<string>();
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error('Timed out waiting for the run');
    const run = await call(`/api/runs/${runId}`, runSummarySchema);
    if (
      run.state === 'awaiting_answers' &&
      run.pendingQuestionnaire &&
      !answered.has(run.pendingQuestionnaire.id)
    ) {
      const q = run.pendingQuestionnaire;
      answered.add(q.id);
      await call(`/api/runs/${runId}/answers`, z.object({ ok: z.boolean() }), answersFor(q, feature));
      console.log(`  answered round ${q.round} (${q.questions.length} questions)`);
    } else if (run.state === 'awaiting_confirmation') {
      await call(`/api/runs/${runId}/discovery-decision`, z.object({ ok: z.boolean() }), { proceed: true });
      console.log('  accepted a preliminary assessment');
    } else if (run.state === 'awaiting_documents') {
      // The client presses "Generate and publish to Confluence" (dry-run unless the app is live).
      await call(`/api/runs/${runId}/documents`, z.object({ ok: z.boolean() }), {});
      console.log('  published the documents');
    } else if (STOP_STATES.has(run.state)) {
      const assessment = await call(`/api/runs/${runId}/assessment`, assessmentSchema).catch(() => null);
      return { run, assessment };
    }
    await sleep(5_000);
  }
}

async function main() {
  const wanted = onlyArg(process.argv.slice(2));
  if (!wanted) throw new Error('Name the features to run: --only rewarded-menu-chest,double-jump');
  const features = loadEvalFeatures().filter((f) => wanted.has(f.id));
  if (!features.length) throw new Error(`No such feature in evals/features.yaml: ${[...wanted].join(', ')}`);
  for (const feature of features) {
    console.log(`- ${feature.id}`);
    const { run, assessment } = await demo(feature);
    console.log(
      assessment
        ? `  ${run.state}: ${assessment.verdict.label}; full scope P85 ${assessment.forecast.full.dates.p85}; cost P85 $${assessment.budget.total.p85.toLocaleString('en-US')}`
        : `  ${run.state}${run.error ? `: ${run.error}` : ''} (no assessment)`,
    );
    console.log(`  ${BASE_URL}/#/analysis/${run.id}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
