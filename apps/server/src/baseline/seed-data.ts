import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { parseFrontMatter } from '../util/front-matter.js';

/** seed/baseline at the repository root, reached the same way from src/ and dist/. */
export const SEED_DIR = fileURLToPath(new URL('../../../../seed/baseline', import.meta.url));

const text = z.string().min(1);

const projectSchema = z.object({
  name: text,
  genre: text,
  client: text,
  platforms: z.array(text).min(1),
  engine: text,
  pitch: text,
  kickoff: text,
  current_sprint: z.number().int().positive(),
  soft_launch: text,
  global_launch_target: text,
});

const kpisSchema = z.object({
  source: text,
  metrics: z.array(
    z.object({
      key: text,
      name: text,
      unit: z.enum(['users', 'usd', 'ratio', 'number', 'minutes']),
      baseline: z.number(),
      target: z.number(),
    }),
  ),
  revenue_split: z.object({ iap: z.number(), ads: z.number() }),
  financials: z.object({
    approved_budget_usd: z.number().positive(),
    spent_to_date_usd: z.number().nonnegative(),
    user_acquisition_budget_usd: z.number().nonnegative(),
    expected_year1_revenue_usd: z.number().nonnegative(),
    payback_months_after_launch: z.number().positive(),
    discount_rate_annual: z.number().min(0).max(1),
  }),
});

const teamSchema = z.object({
  currency: z.literal('USD'),
  sprint_length_weeks: z.number().int().positive(),
  hours_per_sprint: z.number().positive(),
  capacity_share_new_epic: z.number().gt(0).lte(1),
  roles: z.array(
    z.object({ role: text, name: text, fte: z.number().positive(), rate: z.number().positive() }),
  ),
  velocity: z.array(z.object({ sprint: text, committed: z.number(), completed: z.number() })).min(1),
});

const componentsSchema = z.object({
  components: z.array(
    z.object({
      name: text,
      responsibility: text,
      technology: text,
      sensitivity: z.enum(['core', 'feature', 'cosmetic']),
      depends_on: z.array(text),
      owner: text,
    }),
  ),
  performance_budget: z.array(z.object({ metric: text, budget: text })),
});

const stakeholdersSchema = z.object({
  stakeholders: z.array(
    z.object({
      name: text,
      role: text,
      organization: text,
      interest: text,
      influence: z.enum(['high', 'medium', 'low']),
      engagement: text,
      email: z.email(),
      team: z.boolean(),
    }),
  ),
});

const assumptionsSchema = z.object({
  assumptions: z.array(
    z.object({
      id: text,
      text,
      owner: text,
      status: z.enum(['open', 'validated', 'invalid']),
      validate_by: text,
    }),
  ),
});

const scale = z.number().int().min(1).max(5);
const risksSchema = z.object({
  risks: z.array(
    z.object({
      id: text,
      title: text,
      cause: text,
      event: text,
      effect: text,
      category: text,
      probability: scale,
      impact: scale,
      strategy: z.enum(['Avoid', 'Mitigate', 'Transfer', 'Accept', 'Exploit', 'Enhance', 'Share']),
      response: text,
      owner: text,
      status: z.enum(['open', 'closed']),
    }),
  ),
});

const roadmapSchema = z.object({
  releases: z.array(
    z.object({
      id: text,
      name: text,
      window: text,
      status: z.enum(['done', 'in progress', 'planned']),
      goals: text,
      epics: z.array(text),
    }),
  ),
});

const dodSchema = z.object({ items: z.array(text).min(1) });

const workStatus = z.enum(['todo', 'in_progress', 'done']);
export type WorkStatus = z.infer<typeof workStatus>;

const backlogSchema = z.object({
  epics: z.array(
    z.object({ id: text, summary: text, status: workStatus, components: z.array(text), description: text }),
  ),
  stories: z.array(
    z.object({
      id: text,
      epic: text,
      summary: text,
      story: text,
      points: z.number().int().positive(),
      components: z.array(text),
      status: workStatus,
      acceptance: z.array(text).default([]),
    }),
  ),
});

const frontMatterSchema = z.object({ type: text, title: text });

export interface SeedPage {
  file: string;
  type: string;
  title: string;
  body: string;
}

export interface SeedData {
  project: z.infer<typeof projectSchema>;
  kpis: z.infer<typeof kpisSchema>;
  team: z.infer<typeof teamSchema>;
  components: z.infer<typeof componentsSchema>;
  stakeholders: z.infer<typeof stakeholdersSchema>;
  assumptions: z.infer<typeof assumptionsSchema>;
  risks: z.infer<typeof risksSchema>;
  roadmap: z.infer<typeof roadmapSchema>;
  dod: z.infer<typeof dodSchema>;
  backlog: z.infer<typeof backlogSchema>;
  pages: SeedPage[];
}

export function loadSeedData(dir: string = SEED_DIR): SeedData {
  const data = <T extends z.ZodType>(name: string, schema: T): z.infer<T> => {
    const file = join(dir, 'data', `${name}.yaml`);
    const parsed = schema.safeParse(parse(readFileSync(file, 'utf8')));
    if (!parsed.success) throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`);
    return parsed.data;
  };
  const pagesDir = join(dir, 'pages');
  const pages = readdirSync(pagesDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => parsePage(file, readFileSync(join(pagesDir, file), 'utf8')));

  const seed: SeedData = {
    project: data('project', projectSchema),
    kpis: data('kpis', kpisSchema),
    team: data('team', teamSchema),
    components: data('components', componentsSchema),
    stakeholders: data('stakeholders', stakeholdersSchema),
    assumptions: data('assumptions', assumptionsSchema),
    risks: data('risks', risksSchema),
    roadmap: data('roadmap', roadmapSchema),
    dod: data('dod', dodSchema),
    backlog: data('backlog', backlogSchema),
    pages,
  };
  checkReferences(seed);
  return seed;
}

function parsePage(file: string, source: string): SeedPage {
  const { data, body } = parseFrontMatter(source, frontMatterSchema, file);
  return { file, ...data, body };
}

/** Cross-file consistency: every reference points at something that exists, ids are unique. */
function checkReferences(seed: SeedData) {
  const problems: string[] = [];
  const components = new Set(seed.components.components.map((c) => c.name));
  const epics = new Set(seed.backlog.epics.map((e) => e.id));

  for (const c of seed.components.components) {
    for (const dep of c.depends_on)
      if (!components.has(dep)) problems.push(`${c.name} depends on unknown component "${dep}"`);
  }
  for (const item of [...seed.backlog.epics, ...seed.backlog.stories]) {
    for (const name of item.components)
      if (!components.has(name)) problems.push(`${item.id} uses unknown component "${name}"`);
  }
  for (const story of seed.backlog.stories) {
    if (!epics.has(story.epic)) problems.push(`${story.id} belongs to unknown epic ${story.epic}`);
  }
  for (const release of seed.roadmap.releases) {
    for (const epic of release.epics)
      if (!epics.has(epic)) problems.push(`release ${release.id} lists unknown epic ${epic}`);
  }
  const ids = [
    ...seed.backlog.epics.map((e) => e.id),
    ...seed.backlog.stories.map((s) => s.id),
    ...seed.risks.risks.map((r) => r.id),
    ...seed.assumptions.assumptions.map((a) => a.id),
  ];
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`duplicate id ${id}`);
  const types = seed.pages.map((p) => p.type);
  for (const type of new Set(types.filter((t, i) => types.indexOf(t) !== i)))
    problems.push(`duplicate page type ${type}`);

  if (problems.length > 0) throw new Error(`Seed data is inconsistent:\n- ${problems.join('\n- ')}`);
}
