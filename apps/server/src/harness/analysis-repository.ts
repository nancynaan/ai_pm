import { type Assessment, assessmentSchema, type AssessmentSummary } from '@ai-pm/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { ImpactAnalysis, RequirementsAnalysis } from '../agents/schemas.js';
import type { Db } from '../db/client.js';
import {
  assessments,
  assumptions,
  componentImpacts,
  constraints,
  dependencies,
  featureAnalyses,
  featureRequests,
  pipelineRuns,
  requirementConflicts,
  requirements,
} from '../db/schema.js';
import type { Magnitude } from './magnitude.js';

/** REQ-FR-001, REQ-NFR-001 … in the order the analyst listed them. */
export function requirementCodes(items: { ref: string; type: 'functional' | 'non_functional' }[]) {
  const counters = { functional: 0, non_functional: 0 };
  const codes = new Map<string, string>();
  for (const item of items) {
    const n = ++counters[item.type];
    codes.set(item.ref, `REQ-${item.type === 'functional' ? 'FR' : 'NFR'}-${String(n).padStart(3, '0')}`);
  }
  return codes;
}

export interface AnalysisToSave {
  analysis: RequirementsAnalysis;
  impact: ImpactAnalysis;
  magnitude: Magnitude;
  magnitudeReason: string;
}

/** Persistence of elicitation and analysis results. Re-analysis replaces the previous results. */
export function createAnalysisRepository(db: Db) {
  return {
    async setEpicKey(runId: string, epicKey: string) {
      const [run] = await db
        .select({ featureRequestId: pipelineRuns.featureRequestId })
        .from(pipelineRuns)
        .where(eq(pipelineRuns.id, runId));
      if (run)
        await db.update(featureRequests).set({ epicKey }).where(eq(featureRequests.id, run.featureRequestId));
    },

    /** Discovery assumptions: client hypotheses, AI hypotheses, defaults and accepted open issues. */
    async replaceElicitationAssumptions(
      runId: string,
      items: { text: string; reason: string; kind?: string }[],
    ) {
      await db.transaction(async (tx) => {
        await tx
          .delete(assumptions)
          .where(and(eq(assumptions.runId, runId), eq(assumptions.source, 'elicitation')));
        if (items.length) {
          await tx.insert(assumptions).values(
            items.map((a) => ({
              runId,
              text: `${a.text} (${a.reason})`,
              source: 'elicitation',
              kind: a.kind ?? 'assumption',
            })),
          );
        }
      });
    },

    /** "[client hypothesis] …" lines for the analysts' prompts. */
    async elicitationAssumptions(runId: string): Promise<string[]> {
      const rows = await db
        .select({ text: assumptions.text, kind: assumptions.kind })
        .from(assumptions)
        .where(and(eq(assumptions.runId, runId), eq(assumptions.source, 'elicitation')));
      return rows.map((r) => `[${r.kind.replaceAll('_', ' ')}] ${r.text}`);
    },

    async saveAnalysis(runId: string, { analysis, impact, magnitude, magnitudeReason }: AnalysisToSave) {
      const codes = requirementCodes(analysis.requirements);
      await db.transaction(async (tx) => {
        for (const table of [
          requirements,
          requirementConflicts,
          constraints,
          componentImpacts,
          dependencies,
        ]) {
          await tx.delete(table).where(eq(table.runId, runId));
        }
        await tx
          .delete(assumptions)
          .where(and(eq(assumptions.runId, runId), eq(assumptions.source, 'analysis')));

        await tx.insert(requirements).values(
          analysis.requirements.map((r) => ({
            runId,
            code: codes.get(r.ref)!,
            type: r.type,
            category: r.category,
            title: r.title,
            description: r.description,
            moscow: r.moscow,
            inMvp: r.inMvp,
            source: r.source,
          })),
        );
        if (analysis.conflicts.length) {
          await tx.insert(requirementConflicts).values(
            analysis.conflicts.map((c) => ({
              runId,
              requirementCode: c.requirementRef ? (codes.get(c.requirementRef) ?? null) : null,
              withRef: c.with,
              kind: c.kind,
              description: c.description,
              blocking: c.blocking,
              resolutionOptions: c.resolutionOptions,
            })),
          );
        }
        if (analysis.assumptions.length) {
          await tx
            .insert(assumptions)
            .values(
              analysis.assumptions.map((a) => ({ runId, text: a.text, owner: a.owner, source: 'analysis' })),
            );
        }
        if (analysis.constraints.length) {
          await tx.insert(constraints).values(analysis.constraints.map((c) => ({ runId, ...c })));
        }
        if (impact.componentImpacts.length) {
          await tx.insert(componentImpacts).values(impact.componentImpacts.map((i) => ({ runId, ...i })));
        }
        if (impact.dependencies.length) {
          await tx.insert(dependencies).values(impact.dependencies.map((d) => ({ runId, ...d })));
        }
        const summary = {
          magnitude,
          magnitudeReason,
          mvpSummary: analysis.mvpSummary,
          spike: {
            needed: impact.spike.needed,
            ...(impact.spike.question ? { question: impact.spike.question } : {}),
            ...(impact.spike.timeboxDays ? { timeboxDays: impact.spike.timeboxDays } : {}),
          },
          performanceRisks: impact.performanceRisks,
          updatedAt: new Date(),
        };
        await tx
          .insert(featureAnalyses)
          .values({ runId, ...summary })
          .onConflictDoUpdate({ target: featureAnalyses.runId, set: summary });
      });
      return codes;
    },

    async requirementsOf(runId: string) {
      return db
        .select()
        .from(requirements)
        .where(eq(requirements.runId, runId))
        .orderBy(asc(requirements.code));
    },

    /** Everything the analysis stage stored, for the assessment. */
    async analysisOf(runId: string): Promise<StoredAnalysis> {
      const [reqs, conflicts, impacts, deps, [summary]] = await Promise.all([
        db.select().from(requirements).where(eq(requirements.runId, runId)).orderBy(asc(requirements.code)),
        db.select().from(requirementConflicts).where(eq(requirementConflicts.runId, runId)),
        db.select().from(componentImpacts).where(eq(componentImpacts.runId, runId)),
        db.select().from(dependencies).where(eq(dependencies.runId, runId)),
        db.select().from(featureAnalyses).where(eq(featureAnalyses.runId, runId)),
      ]);
      return {
        requirements: reqs.map((r) => ({
          code: r.code,
          type: r.type,
          category: r.category,
          title: r.title,
          description: r.description,
          moscow: r.moscow,
          inMvp: r.inMvp,
          source: r.source,
        })),
        conflicts: conflicts.map((c) => ({
          requirementCode: c.requirementCode,
          with: c.withRef,
          kind: c.kind,
          description: c.description,
          blocking: c.blocking,
        })),
        impacts: impacts.map((i) => ({ component: i.component, level: i.level, rationale: i.rationale })),
        dependencies: deps.map((d) => ({
          type: d.type,
          target: d.target,
          description: d.description,
          blocking: d.blocking,
        })),
        magnitude: summary?.magnitude ?? 'unknown',
        magnitudeReason: summary?.magnitudeReason ?? '',
        mvpSummary: summary?.mvpSummary ?? '',
        spike: summary?.spike ?? { needed: false },
        performanceRisks: summary?.performanceRisks ?? [],
      };
    },

    async saveAssessment(assessment: Assessment) {
      const row = {
        decision: assessment.verdict.decision,
        preliminary: assessment.preliminary,
        data: assessment,
        updatedAt: new Date(),
      };
      await db
        .insert(assessments)
        .values({ runId: assessment.runId, ...row })
        .onConflictDoUpdate({ target: assessments.runId, set: row });
    },

    async assessmentOf(runId: string): Promise<Assessment | null> {
      const [row] = await db.select().from(assessments).where(eq(assessments.runId, runId));
      return row ? assessmentSchema.parse(row.data) : null;
    },

    async listAssessments(limit = 50): Promise<AssessmentSummary[]> {
      const rows = await db.select().from(assessments).orderBy(desc(assessments.updatedAt)).limit(limit);
      return rows.flatMap((row) => {
        const parsed = assessmentSchema.safeParse(row.data);
        if (!parsed.success) return [];
        const a = parsed.data;
        return [
          {
            runId: a.runId,
            title: a.title,
            updatedAt: row.updatedAt.toISOString(),
            decision: a.verdict.decision,
            label: a.verdict.label,
            preliminary: a.preliminary,
            p85Date: a.forecast.full.dates.p85,
            p85BudgetUsd: a.budget.total.p85,
            baseNpvUsd: a.value.scenarios.find((s) => s.name === 'base')?.npvUsd ?? 0,
          },
        ];
      });
    },
  };
}

export interface StoredAnalysis {
  requirements: {
    code: string;
    type: string;
    category: string;
    title: string;
    description: string;
    moscow: string;
    inMvp: boolean;
    source: string;
  }[];
  conflicts: {
    requirementCode: string | null;
    with: string;
    kind: string;
    description: string;
    blocking: boolean;
  }[];
  impacts: { component: string; level: string; rationale: string }[];
  dependencies: { type: string; target: string; description: string; blocking: boolean }[];
  magnitude: string;
  magnitudeReason: string;
  mvpSummary: string;
  spike: { needed: boolean; question?: string; timeboxDays?: number };
  performanceRisks: string[];
}

export type AnalysisRepository = ReturnType<typeof createAnalysisRepository>;
