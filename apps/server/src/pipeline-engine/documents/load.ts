import type { SeedData } from '../../baseline/seed-data.js';
import type { AnalysisRepository } from '../analysis-repository.js';
import type { ContextBuilder } from '../context.js';
import type { RunRecord, RunRepository } from '../repository.js';
import type { DiscoveryOutput } from '../stages/eliciting.js';
import type { DocumentInputs } from './inputs.js';
import type { DocumentRepository } from './repository.js';

export interface DocumentInputDeps {
  analysis: Pick<AnalysisRepository, 'assessmentOf' | 'analysisOf'>;
  context: Pick<ContextBuilder, 'baselineData'>;
  documents: Pick<DocumentRepository, 'recordsOf' | 'epicKeyOf'>;
  repo: Pick<RunRepository, 'answeredQuestionnaires' | 'latestStageOutput'>;
}

/** Reads everything a run's documents are built from (the documents stage and the writer eval). */
export async function loadDocumentInputs(
  deps: DocumentInputDeps,
  run: Pick<RunRecord, 'id' | 'title' | 'description' | 'projectId'>,
  faNumber: number,
): Promise<DocumentInputs> {
  const assessment = await deps.analysis.assessmentOf(run.id);
  if (!assessment) throw new Error('This run has no assessment yet; the documents are built from it.');
  const [analysis, answered, discovery, intake, data, records, epicKey] = await Promise.all([
    deps.analysis.analysisOf(run.id),
    deps.repo.answeredQuestionnaires(run.id),
    deps.repo.latestStageOutput(run.id, 'eliciting') as Promise<Partial<DiscoveryOutput> | null>,
    deps.repo.latestStageOutput(run.id, 'intake') as Promise<{
      elicitation?: { summary?: string; epicSummary?: string };
    } | null>,
    deps.context.baselineData(run.projectId, ['project_charter', 'product_roadmap']),
    deps.documents.recordsOf(run.id),
    deps.documents.epicKeyOf(run.id),
  ]);
  const charter = data.project_charter as
    { project: SeedData['project']; financials: SeedData['kpis']['financials'] } | undefined;
  const roadmap = data.product_roadmap as SeedData['roadmap'] | undefined;
  if (!charter || !roadmap)
    throw new Error('The project baseline is incomplete; run the seed (npm run seed) first.');

  return {
    run: { id: run.id, title: run.title, description: run.description },
    faNumber,
    featureName: intake?.elicitation?.epicSummary ?? run.title,
    epicKey,
    restatement: intake?.elicitation?.summary ?? null,
    assessment,
    analysis,
    report: discovery?.report ?? null,
    answered,
    ...records,
    baseline: { projectName: charter.project.name, financials: charter.financials, roadmap },
  };
}
