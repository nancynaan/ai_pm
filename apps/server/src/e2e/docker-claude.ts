import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type ClaudeCli, execFileAsync } from '../integrations/claude-cli.js';

const COMPOSE_FILE = fileURLToPath(new URL('../../../../docker-compose.yml', import.meta.url));

/**
 * For recording cassettes: runs `claude -p` inside the running app container, which is signed
 * in with the subscription token, instead of a local CLI. The system prompt file is copied into
 * the container first, since the local path does not exist there.
 */
export function dockerClaude(): Pick<ClaudeCli, 'print'> {
  const exec = (args: string[], timeoutMs: number, input?: string) =>
    execFileAsync('docker', ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'app', ...args], {
      env: process.env,
      timeoutMs,
      input,
    });
  return {
    async print(args, prompt, timeoutMs) {
      const at = args.indexOf('--system-prompt-file');
      const local = args[at + 1];
      if (at < 0 || !local) throw new Error('dockerClaude needs --system-prompt-file');
      const remote = `/tmp/aipm-e2e-${randomUUID()}.md`;
      await exec(['sh', '-c', `cat > ${remote}`], 30_000, readFileSync(local, 'utf8'));
      const remoteArgs = [...args];
      remoteArgs[at + 1] = remote;
      try {
        return await exec(['claude', '-p', ...remoteArgs], timeoutMs, prompt);
      } finally {
        await exec(['rm', '-f', remote], 30_000);
      }
    },
  };
}
