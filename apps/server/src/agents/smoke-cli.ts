// One real agent call through `claude -p`, to check the Claude login and the JSON-schema path:
//   docker compose exec app node apps/server/dist/agents/smoke-cli.js
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createClaudeCli } from '../integrations/claude-cli.js';
import { createAgentRunner } from './runner.js';

const config = loadConfig();
const runner = createAgentRunner({
  claude: createClaudeCli({ cliPath: config.claude.cliPath }),
  record: async (call) =>
    console.log(
      `call: ${call.status}, ${call.inputTokens ?? '?'} input / ${call.outputTokens ?? '?'} output tokens, ${call.durationMs} ms`,
    ),
});

try {
  const answer = await runner.run(
    {
      name: 'smoke',
      model: config.claude.model,
      effort: 'low',
      systemPrompt: 'You are a project manager. Answer briefly.',
      schema: z.object({
        ceremony: z.string().describe('One Scrum event'),
        purpose: z.string().describe('Its purpose in one sentence'),
      }),
    },
    'Name one Scrum event and its purpose.',
  );
  console.log('answer:', JSON.stringify(answer));
  console.log(`Claude works through the CLI with ${config.claude.model}.`);
} catch (err) {
  console.error(`Smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
