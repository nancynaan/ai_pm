import type { AppConfig } from '../config.js';
import type { AtlassianGateway } from '../integrations/atlassian/index.js';
import type { ClaudeCli } from '../integrations/claude-cli.js';
import { failed, type HealthProbe, notConfigured, ok } from './probe.js';

export interface ProbeDeps {
  config: AppConfig;
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
  atlassian?: AtlassianGateway;
  claude: Pick<ClaudeCli, 'version' | 'authStatus'>;
  /** CLAUDE_CODE_OAUTH_TOKEN, only to check its format. */
  claudeToken?: string;
}

const MISSING_ATLASSIAN = 'Set ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN in .env';

/** Everything Phase 0 must prove before the pipeline can run. */
export function buildProbes({
  config,
  query,
  atlassian,
  claude,
  claudeToken,
}: ProbeDeps): HealthProbe[] {
  const { jiraProjectKey, jiraBoardId, confluenceSpaceKey } = config.atlassian;
  return [
    {
      name: 'database',
      label: 'PostgreSQL',
      run: async () => {
        const { rows } = await query('select count(*)::int as n from drizzle.__drizzle_migrations');
        return ok(`Connected, ${String(rows[0]?.n ?? 0)} migration(s) applied`);
      },
    },
    {
      name: 'jira',
      label: 'Jira sign-in',
      run: async () => {
        if (!atlassian) return notConfigured(MISSING_ATLASSIAN);
        const me = await atlassian.jira.getMyself();
        return ok(`Signed in as ${me.displayName}`);
      },
    },
    {
      name: 'jira_project',
      label: 'Jira Scrum project',
      run: async () => {
        if (!atlassian) return notConfigured(MISSING_ATLASSIAN);
        if (!jiraProjectKey) return notConfigured('Set JIRA_PROJECT_KEY in .env');
        const project = await atlassian.jira.getProject(jiraProjectKey);
        if (project.projectTypeKey !== 'software') {
          return failed(
            `${project.key} is a "${project.projectTypeKey}" project; the pipeline needs a Jira Software Scrum project`,
          );
        }
        if (project.style !== 'classic') {
          return failed(`${project.key} is team-managed; create a company-managed Scrum project instead`);
        }
        const boards = await atlassian.agile.findBoards(jiraProjectKey);
        const board = jiraBoardId
          ? boards.find((b) => b.id === jiraBoardId)
          : boards.find((b) => b.type === 'scrum');
        if (!board) {
          return failed(
            jiraBoardId
              ? `Board #${jiraBoardId} (JIRA_BOARD_ID) does not belong to ${project.key}`
              : `${project.key} has no Scrum board; create the project from the Scrum template`,
          );
        }
        if (board.type !== 'scrum')
          return failed(`Board "${board.name}" is a ${board.type} board, not Scrum`);
        return ok(
          `${project.name} (${project.key}), company-managed, Scrum board "${board.name}" #${board.id}`,
        );
      },
    },
    {
      name: 'confluence',
      label: 'Confluence space',
      run: async () => {
        if (!atlassian) return notConfigured(MISSING_ATLASSIAN);
        if (!confluenceSpaceKey) return notConfigured('Set CONFLUENCE_SPACE_KEY in .env');
        const space = await atlassian.confluence.getSpaceByKey(confluenceSpaceKey);
        if (!space)
          return failed(`Space ${confluenceSpaceKey} not found, or the token's account cannot see it`);
        return ok(`${space.name} (${space.key})`);
      },
    },
    {
      name: 'claude',
      label: 'Claude (Code CLI)',
      run: async () => {
        const version = await claude.version();
        const status = await claude.authStatus();
        if (!status.loggedIn) {
          return notConfigured(
            `Claude Code ${version} is installed but not signed in. For Docker, run "claude setup-token" on your machine and put the token in .env as CLAUDE_CODE_OAUTH_TOKEN; on your machine, run "claude auth login".`,
          );
        }
        // `auth status` only sees that a token is present; catch tokens that cannot be valid.
        if (claudeToken && !claudeToken.startsWith('sk-ant-oat')) {
          return failed(
            'CLAUDE_CODE_OAUTH_TOKEN is not a token from "claude setup-token" (those start with sk-ant-oat01-). Run it again and paste the whole token.',
          );
        }
        return ok(
          `Claude Code ${version}, signed in (${status.authMethod}); agents use ${config.claude.model}`,
        );
      },
    },
  ];
}
