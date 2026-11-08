import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CassetteMiss, createCassette } from './cassette.js';
import { createAgentRunner } from './runner.js';

const ok = (answer: unknown) => ({
  stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: answer }),
  stderr: '',
  exitCode: 0,
});
const spec = {
  name: 'picker',
  model: 'claude-opus-5-5',
  effort: 'low' as const,
  systemPrompt: 'Pick.',
  schema: z.object({ n: z.number() }),
};

describe('cassette', () => {
  it('records answers, then replays them in order without calling Claude', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cassette-')), 'c.json');
    const print = vi
      .fn()
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockResolvedValueOnce(ok({ n: 2 }));
    const recording = createCassette({ file, mode: 'record' });
    const runner = createAgentRunner({ claude: { print }, cassette: recording });
    expect(await runner.run(spec, 'first')).toEqual({ n: 1 });
    expect(await runner.run(spec, 'second')).toEqual({ n: 2 });
    recording.rewind();
    expect(await runner.run(spec, 'first again')).toEqual({ n: 1 }); // served from the recording
    expect(print).toHaveBeenCalledTimes(2);
    recording.save();
    expect(JSON.parse(readFileSync(file, 'utf8')).calls).toHaveLength(2);

    const replay = createCassette({ file, mode: 'replay' });
    const offline = vi.fn();
    const replayer = createAgentRunner({ claude: { print: offline }, cassette: replay });
    expect(await replayer.run(spec, 'first')).toEqual({ n: 1 });
    expect(await replayer.run(spec, 'changed prompt')).toEqual({ n: 2 });
    expect(replay.drift).toEqual(['picker #2']);
    await expect(replayer.run(spec, 'third')).rejects.toThrow(CassetteMiss);
    expect(offline).not.toHaveBeenCalled();
  });

  it('never stores a usage-limit answer', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cassette-')), 'c.json');
    const limit = {
      stdout: JSON.stringify({ type: 'result', is_error: true, result: 'usage limit reached' }),
      stderr: '',
      exitCode: 1,
    };
    const recording = createCassette({ file, mode: 'record' });
    const runner = createAgentRunner({
      claude: { print: vi.fn().mockResolvedValue(limit) },
      cassette: recording,
    });
    await expect(runner.run(spec, 'x')).rejects.toThrow(/usage limit/);
    recording.save();
    expect(() => createCassette({ file, mode: 'replay' })).toThrow(CassetteMiss);
  });
});
