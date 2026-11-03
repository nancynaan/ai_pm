import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseFrontMatter } from '../util/front-matter.js';
import type { AgentSpec, Effort } from './runner.js';

/** agents/ and skills/ at the repository root, reached the same way from src/ and dist/. */
export const AGENTS_DIR = fileURLToPath(new URL('../../../../agents', import.meta.url));
export const SKILLS_DIR = fileURLToPath(new URL('../../../../skills', import.meta.url));

const skillFrontMatter = z.object({ name: z.string().min(1), description: z.string().min(1) });

export interface Skill {
  name: string;
  description: string;
  body: string;
}

/** A skill in the Agent Skills format: skills/<name>/SKILL.md. */
export function loadSkill(name: string, dir: string = SKILLS_DIR): Skill {
  const file = join(dir, name, 'SKILL.md');
  if (!existsSync(file)) throw new Error(`Skill "${name}" not found at ${file}`);
  const { data, body } = parseFrontMatter(readFileSync(file, 'utf8'), skillFrontMatter, file);
  if (data.name !== name)
    throw new Error(`${file}: front matter name "${data.name}" does not match the folder`);
  return { ...data, body };
}

const agentFrontMatter = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  skills: z.array(z.string()).default([]),
  /** Name of the zod output schema registered in code. */
  output: z.string().min(1),
});

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  effort: Effort;
  skills: string[];
  output: string;
  prompt: string;
}

/** Every agents/<name>.agent.md file: front matter plus the system prompt. */
export function loadAgentDefinitions(dir: string = AGENTS_DIR): Map<string, AgentDefinition> {
  const definitions = new Map<string, AgentDefinition>();
  if (!existsSync(dir)) return definitions;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.agent.md'))) {
    const path = join(dir, file);
    const { data, body } = parseFrontMatter(readFileSync(path, 'utf8'), agentFrontMatter, path);
    if (`${data.name}.agent.md` !== file)
      throw new Error(`${path}: name "${data.name}" does not match the file name`);
    definitions.set(data.name, { ...data, prompt: body });
  }
  return definitions;
}

/**
 * Turns a definition into a runnable spec: the agent's prompt, then each declared skill, then the
 * project baseline digest. The output schema comes from the code-side registry.
 */
export function buildAgentSpec<T>(
  definition: AgentDefinition,
  options: {
    defaultModel: string;
    schemas: Record<string, z.ZodType>;
    baselineDigest?: string | null;
    skillsDir?: string;
  },
): AgentSpec<T> {
  const schema = options.schemas[definition.output];
  if (!schema) throw new Error(`Agent ${definition.name}: no output schema named "${definition.output}"`);
  const sections = [
    definition.prompt,
    ...definition.skills.map((name) => {
      const skill = loadSkill(name, options.skillsDir);
      return `# Skill: ${skill.name}\n\n${skill.body}`;
    }),
    ...(options.baselineDigest ? [`# Project baseline\n\n${options.baselineDigest}`] : []),
  ];
  return {
    name: definition.name,
    model: definition.model ?? options.defaultModel,
    effort: definition.effort,
    systemPrompt: sections.join('\n\n---\n\n'),
    schema: schema as z.ZodType<T>,
  };
}
