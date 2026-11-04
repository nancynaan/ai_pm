import { and, asc, eq } from 'drizzle-orm';
import type { ImpactAnalysis, RequirementsAnalysis } from '../agents/schemas.js';
import type { Db } from '../db/client.js';
import {
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

    async replaceElicitationAssumptions(runId: string, items: { text: string; reason: string }[]) {
      await db.transaction(async (tx) => {
        await tx
          .delete(assumptions)
          .where(and(eq(assumptions.runId, runId), eq(assumptions.source, 'elicitation')));
        if (items.length) {
          await tx
            .insert(assumptions)
            .values(items.map((a) => ({ runId, text: `${a.text} (${a.reason})`, source: 'elicitation' })));
        }
      });
    },

    async elicitationAssumptions(runId: string): Promise<string[]> {
      const rows = await db
        .select({ text: assumptions.text })
        .from(assumptions)
        .where(and(eq(assumptions.runId, runId), eq(assumptions.source, 'elicitation')));
      return rows.map((r) => r.text);
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
  };
}

export type AnalysisRepository = ReturnType<typeof createAnalysisRepository>;
