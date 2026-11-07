// Stop hook: the quality gate. When TypeScript in apps/ or packages/ changed, run the typecheck,
// ESLint on the changed files, and the tests. On a failure, exit 2 so Claude gets the output and
// fixes it before finishing. It runs once per stop (stop_hook_active prevents a loop).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const bin = (...parts) => join(root, 'node_modules', ...parts);

let input = '';
for await (const chunk of process.stdin) input += chunk;
const payload = (() => {
  try {
    return JSON.parse(input || '{}');
  } catch {
    return {};
  }
})();
if (payload.stop_hook_active) process.exit(0);

const git = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd: root,
  encoding: 'utf8',
});
if (git.status !== 0) process.exit(0);
const changed = git.stdout
  .split('\n')
  .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
  .map((path) => (path.includes(' -> ') ? path.split(' -> ')[1] : path))
  .filter((path) => /^(apps|packages)\/.*\.(ts|tsx)$/.test(path))
  // A deleted file is still in the status list, but ESLint fails on a path that does not exist.
  .filter((path) => existsSync(join(root, path)));
if (!changed.length) process.exit(0);

const run = (label, args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return result.status === 0 ? null : `${label} failed:\n${output.split('\n').slice(-40).join('\n')}`;
};

const failures = [
  run('Typecheck (tsc -b)', [bin('typescript', 'bin', 'tsc'), '-b']),
  run('ESLint', [bin('eslint', 'bin', 'eslint.js'), ...changed]),
  run('Tests (vitest)', [bin('vitest', 'vitest.mjs'), 'run']),
].filter(Boolean);

if (failures.length) {
  process.stderr.write(`Quality gate: fix these before finishing.\n\n${failures.join('\n\n')}\n`);
  process.exit(2);
}
