import { execFile } from 'node:child_process';
import { z } from 'zod';

/**
 * Claude runs through the Claude Code CLI on the user's Claude subscription; there is no API key.
 * On the host the CLI uses its own login. In Docker it uses CLAUDE_CODE_OAUTH_TOKEN (from
 * `claude setup-token`), which it reads from the environment it inherits. Agent calls
 * (`claude -p … --json-schema …`) arrive with the AgentRunner in Phase 2.
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Exec = (
  file: string,
  args: string[],
  /** `input` goes to stdin: prompts can exceed the command-line length limit. */
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; input?: string },
) => Promise<ExecResult>;

/** Resolves with the exit code instead of rejecting on non-zero exits; rejects only when the CLI cannot run. */
export const execFileAsync: Exec = (file, args, { env, timeoutMs, input }) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr, exitCode: 0 });
        if (error.code === 'ENOENT') {
          return reject(
            new Error(`Claude Code CLI not found at "${file}"; install it or set CLAUDE_CLI_PATH`),
          );
        }
        if (error.killed) return reject(new Error(`claude ${args[0] ?? ''} timed out after ${timeoutMs} ms`));
        if (typeof error.code === 'number') return resolve({ stdout, stderr, exitCode: error.code });
        reject(error);
      },
    );
    child.stdin?.end(input ?? '');
  });

const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string(),
});
export type ClaudeAuthStatus = z.infer<typeof authStatusSchema>;

export interface ClaudeCliOptions {
  cliPath: string;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

export function createClaudeCli({ cliPath, exec = execFileAsync, env = process.env }: ClaudeCliOptions) {
  // An empty CLAUDE_CODE_OAUTH_TOKEN= line in .env must not shadow the CLI's own login.
  const childEnv = { ...env };
  if (!childEnv.CLAUDE_CODE_OAUTH_TOKEN?.trim()) delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
  const run = (args: string[], timeoutMs = 15_000, input?: string) =>
    exec(cliPath, args, { env: childEnv, timeoutMs, input });

  return {
    /** Print mode (`claude -p`): the prompt goes in on stdin, the JSON envelope comes back on stdout. */
    print(args: string[], prompt: string, timeoutMs: number) {
      return run(['-p', ...args], timeoutMs, prompt);
    },

    /** e.g. "2.1.316" */
    async version(): Promise<string> {
      const { stdout, exitCode } = await run(['--version']);
      if (exitCode !== 0) throw new Error(`claude --version exited with ${exitCode}`);
      return stdout.trim().split(/\s+/)[0] ?? stdout.trim();
    },

    /** Uses no subscription quota. The CLI exits non-zero when signed out but still prints the status. */
    async authStatus(): Promise<ClaudeAuthStatus> {
      const { stdout } = await run(['auth', 'status', '--json']);
      return authStatusSchema.parse(JSON.parse(stdout));
    },
  };
}

export type ClaudeCli = ReturnType<typeof createClaudeCli>;
