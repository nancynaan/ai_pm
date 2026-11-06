// SessionStart hook: gives a new session the live state of the repository and the stack, so it
// does not spend calls finding out. Prints SessionStart additionalContext; never fails.
import { spawnSync } from 'node:child_process';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const run = (cmd, args, timeout = 5_000) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
};

const lines = ['Live status (from the SessionStart hook):'];

const branch = run('git', ['status', '-sb', '--porcelain']);
if (branch !== null) {
  const [head, ...files] = branch.split('\n').filter(Boolean);
  lines.push(`- Git: ${head?.replace(/^## /, '') ?? 'unknown'}; ${files.length} uncommitted file(s)`);
  if (files.length)
    lines.push(
      ...files.slice(0, 12).map((f) => `  ${f}`),
      ...(files.length > 12 ? [`  … and ${files.length - 12} more`] : []),
    );
}

const log = run('git', ['log', '--oneline', '-3']);
if (log)
  lines.push(
    `- Last commits:\n${log
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')}`,
  );

const ps = run('docker', ['compose', 'ps', '--format', '{{.Service}}: {{.State}} ({{.Status}})'], 8_000);
lines.push(
  ps
    ? `- Containers:\n${ps
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')}`
    : '- Containers: not running or Docker is not available',
);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  }),
);
