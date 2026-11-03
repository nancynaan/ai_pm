import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ClaudeCli } from '../integrations/claude-cli.js';

/**
 * Runs one agent call through `claude -p` on the user's Claude subscription: system prompt from a
 * file, the prompt on stdin, all tools off, and a JSON schema for the answer. The answer is
 * validated with zod; an invalid answer gets up to two repair attempts.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentSpec<T> {
  name: string;
  model: string;
  effort: Effort;
  systemPrompt: string;
  schema: z.ZodType<T>;
}

export interface CallRecord {
  agent: string;
  model: string;
  promptHash: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  status: 'ok' | 'invalid_output' | 'limit_reached' | 'error';
  error: string | null;
}

/** The subscription's usage limit is reached; the stage should pause and retry later. */
export class UsageLimitReached extends Error {
  override name = 'UsageLimitReached';
  constructor(
    message: string,
    readonly resumeAt: Date | null,
  ) {
    super(message);
  }
}

export class AgentCallFailed extends Error {
  override name = 'AgentCallFailed';
}

const envelopeSchema = z.looseObject({
  type: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  api_error_status: z.number().nullish(),
  duration_ms: z.number().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});
type Envelope = z.infer<typeof envelopeSchema>;

const LIMIT_PATTERN = /usage limit|rate limit|limit reached|too many requests/i;

/** "Claude AI usage limit reached|1767225600" carries the reset time as Unix seconds. */
function resumeTime(text: string): Date | null {
  const match = /\|(\d{10})\b/.exec(text);
  return match?.[1] ? new Date(Number(match[1]) * 1000) : null;
}

/**
 * The CLI validates --json-schema with a draft-07 validator, which cannot resolve zod's default
 * draft 2020-12 `$schema` reference; emit draft-07 and drop the `$schema` key.
 */
export function cliJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(jsonSchema).filter(([key]) => key !== '$schema'));
}

function parseAnswer(envelope: Envelope): unknown {
  if (envelope.structured_output !== undefined) return envelope.structured_output;
  const text = (envelope.result ?? '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  return JSON.parse(fenced?.[1] ?? text);
}

export interface AgentRunnerOptions {
  claude: Pick<ClaudeCli, 'print'>;
  /** Stores one row per Claude call (tokens, duration, outcome). */
  record?: (call: CallRecord) => Promise<void>;
  maxRepairs?: number;
  timeoutMs?: number;
}

export function createAgentRunner({
  claude,
  record,
  maxRepairs = 2,
  timeoutMs = 10 * 60_000,
}: AgentRunnerOptions) {
  async function callOnce<T>(spec: AgentSpec<T>, prompt: string, systemPromptFile: string) {
    const args = [
      '--system-prompt-file',
      systemPromptFile,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(cliJsonSchema(spec.schema)),
      '--model',
      spec.model,
      '--effort',
      spec.effort,
      '--tools',
      '',
      '--no-session-persistence',
    ];
    const started = Date.now();
    const { stdout, stderr } = await claude.print(args, prompt, timeoutMs);
    const base = {
      agent: spec.name,
      model: spec.model,
      promptHash: createHash('sha256').update(spec.systemPrompt).update(prompt).digest('hex'),
      durationMs: Date.now() - started,
    };

    let envelope: Envelope;
    try {
      envelope = envelopeSchema.parse(JSON.parse(stdout));
    } catch {
      const detail = (stderr || stdout).trim().slice(0, 500) || 'no output';
      await record?.({ ...base, inputTokens: null, outputTokens: null, status: 'error', error: detail });
      throw new AgentCallFailed(`claude -p returned no result envelope: ${detail}`);
    }
    const usage = envelope.usage;
    const tokens = {
      inputTokens: usage
        ? (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0)
        : null,
      outputTokens: usage?.output_tokens ?? null,
    };
    return { envelope, base: { ...base, ...tokens } };
  }

  return {
    async run<T>(spec: AgentSpec<T>, prompt: string): Promise<T> {
      const dir = await mkdtemp(join(tmpdir(), 'aipm-agent-'));
      const systemPromptFile = join(dir, 'system-prompt.md');
      await writeFile(systemPromptFile, spec.systemPrompt, 'utf8');
      try {
        let currentPrompt = prompt;
        for (let attempt = 0; ; attempt++) {
          const { envelope, base } = await callOnce(spec, currentPrompt, systemPromptFile);
          const text = envelope.result ?? '';

          if (envelope.is_error) {
            if (envelope.api_error_status === 429 || LIMIT_PATTERN.test(text)) {
              await record?.({ ...base, status: 'limit_reached', error: text.slice(0, 500) });
              throw new UsageLimitReached(text || 'Claude usage limit reached', resumeTime(text));
            }
            await record?.({ ...base, status: 'error', error: text.slice(0, 500) });
            if (envelope.api_error_status === 401) {
              throw new AgentCallFailed(
                'Claude rejected the login (401). Run "claude setup-token" and put the token in .env as CLAUDE_CODE_OAUTH_TOKEN.',
              );
            }
            throw new AgentCallFailed(`Claude returned an error: ${text.slice(0, 300)}`);
          }

          let problem: string;
          try {
            const parsed = spec.schema.safeParse(parseAnswer(envelope));
            if (parsed.success) {
              await record?.({ ...base, status: 'ok', error: null });
              return parsed.data;
            }
            problem = z.prettifyError(parsed.error);
          } catch {
            problem = 'The answer was not valid JSON.';
          }
          await record?.({ ...base, status: 'invalid_output', error: problem.slice(0, 500) });
          if (attempt >= maxRepairs) {
            throw new AgentCallFailed(`${spec.name} kept returning invalid output: ${problem.slice(0, 300)}`);
          }
          currentPrompt = `${prompt}\n\nYour previous answer did not match the required JSON schema:\n${problem}\nReturn only JSON that matches the schema.`;
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

export type AgentRunner = ReturnType<typeof createAgentRunner>;
