// PostToolUse hook (Edit|Write): formats the file Claude just wrote with the repo's Prettier.
// Reads the hook payload from stdin; never fails the tool call.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const prettier = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input || '{}');
  const file = payload.tool_response?.filePath ?? payload.tool_input?.file_path;
  if (!file || !existsSync(prettier)) process.exit(0);
  const path = isAbsolute(file) ? file : resolve(root, file);
  const rel = relative(root, path);
  // Only files of this repository, and not generated ones.
  if (rel.startsWith('..') || isAbsolute(rel)) process.exit(0);
  if (/(^|[\\/])(node_modules|dist|coverage)[\\/]|drizzle[\\/]meta[\\/]/.test(rel)) process.exit(0);
  if (!/\.(ts|tsx|js|mjs|cjs|json|md|ya?ml|css|html)$/.test(rel)) process.exit(0);
  execFileSync(process.execPath, [prettier, '--write', '--ignore-unknown', path], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  // Formatting is a convenience; a failure must not block the edit.
}
