import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Record/replay for Claude calls, so tests and CI run the real stages without the CLI and
 * without spending subscription tokens. A cassette holds each agent's answers in call order
 * (`claude -p` stdout, repairs included). Replay serves the n-th answer of an agent to its n-th
 * call: prompts may differ slightly between runs (dates, ids), so order is the key and the
 * prompt hash is only compared to report drift.
 *
 * - `replay`: never calls Claude; a call past the recorded ones throws `CassetteMiss`.
 * - `record`: serves what is recorded, calls Claude for the rest and appends the answer.
 *   Only successful envelopes are stored: a usage-limit or error answer is never replayed.
 */

export type CassetteMode = 'record' | 'replay';

const entrySchema = z.object({ agent: z.string(), promptHash: z.string(), stdout: z.string() });
const fileSchema = z.object({ version: z.literal(1), calls: z.array(entrySchema) });
type Entry = z.infer<typeof entrySchema>;

interface Output {
  stdout: string;
  stderr: string;
}

export class CassetteMiss extends Error {
  override name = 'CassetteMiss';
}

export function createCassette({ file, mode }: { file: string; mode: CassetteMode }) {
  const calls: Entry[] = existsSync(file)
    ? fileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).calls
    : [];
  if (mode === 'replay' && calls.length === 0) {
    throw new CassetteMiss(`No recorded Claude calls in ${file}; record them first (mode "record").`);
  }
  const cursor = new Map<string, number>();
  const drift: string[] = [];
  let live = 0;
  let dirty = false;

  return {
    mode,
    /** Prompts whose hash differs from the recording (informational: replay still answers). */
    drift,
    /** Calls that went to Claude in this session (record mode only). */
    get liveCalls() {
      return live;
    },

    async play(agent: string, promptHash: string, call: () => Promise<Output>): Promise<Output> {
      const n = cursor.get(agent) ?? 0;
      cursor.set(agent, n + 1);
      const recorded = calls.filter((c) => c.agent === agent)[n];
      if (recorded) {
        if (recorded.promptHash !== promptHash) drift.push(`${agent} #${n + 1}`);
        return { stdout: recorded.stdout, stderr: '' };
      }
      if (mode === 'replay') {
        throw new CassetteMiss(`${agent} call #${n + 1} is not in the cassette ${file}; re-record it.`);
      }
      live++;
      const output = await call();
      if (isSuccess(output.stdout)) {
        calls.push({ agent, promptHash, stdout: output.stdout });
        dirty = true;
      }
      return output;
    },

    /** Starts every agent from its first recorded answer again (a second run of the same feature). */
    rewind() {
      cursor.clear();
    },

    /** Writes new recordings to the file; nothing happens in replay or when nothing changed. */
    save() {
      if (!dirty) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ version: 1, calls }, null, 1)}\n`, 'utf8');
      dirty = false;
    },
  };
}

function isSuccess(stdout: string): boolean {
  try {
    const envelope = JSON.parse(stdout) as { is_error?: unknown };
    return envelope.is_error === false;
  } catch {
    return false;
  }
}

export type Cassette = ReturnType<typeof createCassette>;
