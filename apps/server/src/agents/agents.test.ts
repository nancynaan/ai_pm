import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildAgentSpec, loadAgentDefinitions, loadSkill } from './registry.js';
import { AGENT_SCHEMAS } from './schemas.js';
import { AgentCallFailed, type CallRecord, createAgentRunner, UsageLimitReached } from './runner.js';

const spec = {
  name: 'colour-picker',
  model: 'claude-opus-5-5',
  effort: 'low' as const,
  systemPrompt: 'Answer in JSON.',
  schema: z.object({ colour: z.string(), confidence: z.number().int().min(1).max(5) }),
};

const envelope = (fields: Record<string, unknown>) => ({
  stdout: JSON.stringify({
    type: 'result',
    is_error: false,
    usage: { input_tokens: 40, output_tokens: 12 },
    ...fields,
  }),
  stderr: '',
  exitCode: 0,
});

function runnerWith(...responses: ReturnType<typeof envelope>[]) {
  const print = vi.fn();
  for (const r of responses) print.mockResolvedValueOnce(r);
  const calls: CallRecord[] = [];
  const runner = createAgentRunner({ claude: { print }, record: async (c) => void calls.push(c) });
  return { runner, print, calls };
}

describe('agent runner', () => {
  it('runs claude -p with the schema, no tools, and the prompt on stdin', async () => {
    const { runner, print, calls } = runnerWith(
      envelope({ structured_output: { colour: 'red', confidence: 4 } }),
    );

    await expect(runner.run(spec, 'Pick a colour')).resolves.toEqual({ colour: 'red', confidence: 4 });
    const [args, prompt] = print.mock.calls[0] as [string[], string];
    expect(prompt).toBe('Pick a colour');
    expect(args).toEqual(
      expect.arrayContaining(['--tools', '', '--model', 'claude-opus-5-5', '--effort', 'low']),
    );
    const jsonSchema = JSON.parse(args[args.indexOf('--json-schema') + 1]!) as Record<string, unknown>;
    expect(jsonSchema).toMatchObject({ type: 'object', required: ['colour', 'confidence'] });
    expect(jsonSchema).not.toHaveProperty('$schema'); // the CLI's draft-07 validator rejects it
    expect(calls).toMatchObject([{ status: 'ok', inputTokens: 40, outputTokens: 12 }]);
  });

  it('falls back to JSON in the result text and repairs invalid output', async () => {
    const { runner, print, calls } = runnerWith(
      envelope({ result: '{"colour":"red","confidence":9}' }),
      envelope({ result: '```json\n{"colour":"red","confidence":5}\n```' }),
    );

    await expect(runner.run(spec, 'Pick a colour')).resolves.toEqual({ colour: 'red', confidence: 5 });
    expect((print.mock.calls[1] as [string[], string])[1]).toContain(
      'did not match the required JSON schema',
    );
    expect(calls.map((c) => c.status)).toEqual(['invalid_output', 'ok']);
  });

  it('repairs answers that fail the semantic check', async () => {
    const { runner, print, calls } = runnerWith(
      envelope({ structured_output: { colour: 'blue', confidence: 3 } }),
      envelope({ structured_output: { colour: 'red', confidence: 3 } }),
    );
    const check = (v: { colour: string }) => (v.colour === 'red' ? [] : ['The colour must be red.']);
    await expect(runner.run(spec, 'Pick a colour', { check })).resolves.toMatchObject({ colour: 'red' });
    expect((print.mock.calls[1] as [string[], string])[1]).toContain('- The colour must be red.');
    expect(calls.map((c) => c.status)).toEqual(['invalid_output', 'ok']);
  });

  it('gives up after the repair attempts', async () => {
    const bad = envelope({ result: 'not json' });
    const { runner } = runnerWith(bad, bad, bad);
    await expect(runner.run(spec, 'x')).rejects.toThrow(/kept returning invalid output/);
  });

  it('turns a usage limit into UsageLimitReached with the reset time', async () => {
    const { runner, calls } = runnerWith(
      envelope({ is_error: true, result: 'Claude AI usage limit reached|1767225600' }),
    );

    const error = await runner.run(spec, 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageLimitReached);
    expect((error as UsageLimitReached).resumeAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(calls[0]?.status).toBe('limit_reached');
  });

  it('recognizes the subscription limit wording as a pause', async () => {
    const { runner } = runnerWith(
      envelope({ is_error: true, result: "You've hit your 5-hour limit · resets 7:40pm (America/New_York)" }),
    );
    await expect(runner.run(spec, 'x')).rejects.toBeInstanceOf(UsageLimitReached);
  });

  it('explains a rejected login', async () => {
    const { runner } = runnerWith(
      envelope({
        is_error: true,
        api_error_status: 401,
        result: 'Failed to authenticate. API Error: 401 Invalid bearer token',
      }),
    );
    await expect(runner.run(spec, 'x')).rejects.toThrow(AgentCallFailed);
    await expect(
      runnerWith(envelope({ is_error: true, api_error_status: 401, result: '' })).runner.run(spec, 'x'),
    ).rejects.toThrow(/claude setup-token/);
  });
});

describe('the real agents and skills', () => {
  it('all load, and every agent has an output schema and existing skills', () => {
    const definitions = loadAgentDefinitions();
    expect([...definitions.keys()].sort()).toEqual([
      'discovery-review',
      'elicitation',
      'estimator',
      'impact-analyst',
      'pm-writer',
      'requirements-analyst',
      'risk-analyst',
      'value-analyst',
    ]);
    for (const definition of definitions.values()) {
      const built = buildAgentSpec(definition, { defaultModel: 'claude-opus-5-5', schemas: AGENT_SCHEMAS });
      expect(built.systemPrompt.length).toBeGreaterThan(200);
    }
  });
});

describe('agent registry', () => {
  const root = mkdtempSync(join(tmpdir(), 'aipm-registry-'));
  mkdirSync(join(root, 'agents'));
  mkdirSync(join(root, 'skills', 'scrum-basics'), { recursive: true });
  writeFileSync(
    join(root, 'skills', 'scrum-basics', 'SKILL.md'),
    '---\nname: scrum-basics\ndescription: Scrum events\n---\nSprints last two weeks.',
  );
  writeFileSync(
    join(root, 'agents', 'helper.agent.md'),
    '---\nname: helper\ndescription: Test agent\neffort: high\nskills: [scrum-basics]\noutput: Colour\n---\nYou help.',
  );

  it('loads skills and agent definitions from Markdown with front matter', () => {
    expect(loadSkill('scrum-basics', join(root, 'skills')).body).toBe('Sprints last two weeks.');
    const definition = loadAgentDefinitions(join(root, 'agents')).get('helper');
    expect(definition).toMatchObject({
      effort: 'high',
      skills: ['scrum-basics'],
      output: 'Colour',
      prompt: 'You help.',
    });
  });

  it('builds a spec: prompt, then skills, then the baseline digest', () => {
    const definition = loadAgentDefinitions(join(root, 'agents')).get('helper')!;
    const built = buildAgentSpec(definition, {
      defaultModel: 'claude-opus-5-5',
      schemas: { Colour: spec.schema },
      baselineDigest: '# Comet Run',
      skillsDir: join(root, 'skills'),
    });
    expect(built.model).toBe('claude-opus-5-5');
    expect(built.systemPrompt).toBe(
      'You help.\n\n---\n\n# Skill: scrum-basics\n\nSprints last two weeks.\n\n---\n\n# Project baseline\n\n# Comet Run',
    );
    expect(() => buildAgentSpec(definition, { defaultModel: 'x', schemas: {} })).toThrow(/no output schema/);
  });
});
