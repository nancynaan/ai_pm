import { createHash } from 'node:crypto';
import { reportForPrompt } from '../discovery.js';
import { analysisSection, requirementLines } from '../stages/estimating.js';
import { clientRequest, section, transcript } from '../stages/prompts.js';
import type { Figures } from './figures.js';
import type { DocumentInputs } from './inputs.js';
import type { Templates } from './templates.js';

/**
 * The pm-writer's prompt: the run's data without computed numbers in prose (sizes, costs and
 * dates come only through the figure list), the templates, and the figures by key.
 */
export function writerPrompt(
  inputs: DocumentInputs,
  figures: Figures,
  templates: Templates,
  roadmapNeeded: boolean,
): string {
  const a = inputs.assessment;
  const storyMap = a.storyMap.items
    .map(
      (i) =>
        `- ${i.ref} [${i.type}, ${i.release}, ${i.discipline}] ${i.title} (${i.requirementCodes.join(', ') || 'no REQ'})`,
    )
    .join('\n');
  const risks = a.risks
    .map(
      (r) =>
        `- ${r.id} [${r.level}, ${r.strategy}${r.existingRiskId ? `, updates ${r.existingRiskId}` : ''}] ${r.title}: ${r.event}`,
    )
    .join('\n');
  const assumptions = inputs.assumptions
    .map((x) => `- [${x.kind.replaceAll('_', ' ')}] ${x.text}`)
    .join('\n');
  const constraints = inputs.constraints.map((c) => `- [${c.type}] ${c.text}`).join('\n');
  const value = a.value.scenarios.map((s) => `- ${s.name}: ${s.rationale}`).join('\n');

  return [
    section('Feature request from the client', clientRequest(inputs.run.description)),
    ...(inputs.restatement ? [section('Restatement at intake', inputs.restatement)] : []),
    section('Discovery answers', transcript(inputs.answered)),
    ...(inputs.report ? [section('Discovery completeness report', reportForPrompt(inputs.report))] : []),
    section('Analyzed requirements', requirementLines(inputs.analysis)),
    section('Analysis', analysisSection(inputs.analysis)),
    section('Constraints', constraints || '(none)'),
    section('Assumptions', assumptions || '(none)'),
    section('Story map (sizes are in the tables, not here)', storyMap),
    section('Risks', risks || '(none)'),
    section(
      'Value',
      `Primary KPI: ${a.value.primaryKpi}. Drivers: ${a.value.drivers}\n${value}\nValidation: ${a.value.validation}`,
    ),
    section(
      'Verdict (decided by the pipeline engine)',
      [
        `${a.verdict.label}${a.preliminary ? ' (preliminary)' : ''}`,
        a.verdict.conditions.length
          ? `Conditions (printed in the document already):\n${a.verdict.conditions.map((c) => `- ${c}`).join('\n')}`
          : 'No conditions.',
      ].join('\n'),
    ),
    section(
      'Roadmap',
      roadmapNeeded
        ? 'The feature delays a committed release or the launch target, so a Roadmap Update Proposal is needed: write the `roadmap` text.'
        : 'The feature does not change the roadmap commitments: return `roadmap: null`.',
    ),
    section(
      'Figures (cite as {{figure:key}}; never type these numbers yourself)',
      Object.entries(figures)
        .map(([k, v]) => `- ${k} = ${v}`)
        .join('\n'),
    ),
    section(
      'Document templates (your text goes into the {{text:…}} slots; code fills the rest)',
      Object.entries(templates)
        .filter(([name]) => name !== 'risk_register' && name !== 'assumption_log')
        .map(([name, body]) => `## Template: ${name}\n\n${body}`)
        .join('\n\n'),
    ),
    section('Task', 'Write the text of all documents of this feature as the DocumentDraft JSON.'),
  ].join('\n\n');
}

/** Same inputs → same draft: a re-publish of an unchanged assessment reuses the stored draft. */
export const inputHash = (prompt: string, systemPromptVersion: string) =>
  createHash('sha256').update(systemPromptVersion).update(prompt).digest('hex');
