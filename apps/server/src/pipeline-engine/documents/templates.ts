import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS_DIR } from '../../agents/registry.js';

/**
 * The document templates (skills/pm-artifacts/templates). Slots: {{text:x}} (the writer),
 * {{table:x}} and {{list:x}} (code, from the DB), {{figure:key}} (the figure registry) and
 * {{macro:x}} (Confluence macros: verdict badge, panels, child-page list).
 */
export const TEMPLATE_FILES = {
  feature_brief: 'feature-brief.md',
  requirements: 'requirements.md',
  estimation: 'estimation.md',
  roadmap_proposal: 'roadmap-proposal.md',
  risk_register: 'risk-register-block.md',
  assumption_log: 'assumption-log-block.md',
} as const;
export type TemplateName = keyof typeof TEMPLATE_FILES;
export type Templates = Record<TemplateName, string>;

export function loadTemplates(dir = join(SKILLS_DIR, 'pm-artifacts', 'templates')): Templates {
  return Object.fromEntries(
    Object.entries(TEMPLATE_FILES).map(([name, file]) => [name, readFileSync(join(dir, file), 'utf8')]),
  ) as Templates;
}

/** The slots of one kind a template uses, e.g. every {{text:x}}. */
export const slotsOf = (template: string, kind: 'text' | 'table' | 'list' | 'macro') =>
  [...template.matchAll(new RegExp(`\\{\\{${kind}:([a-z_]+)\\}\\}`, 'g'))].map((m) => m[1]!);
