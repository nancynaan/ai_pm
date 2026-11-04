import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { baselineArtifacts } from '../db/schema.js';
import type { AtlassianGateway } from '../integrations/atlassian/index.js';
import type { Sensitivity } from './magnitude.js';

/**
 * Everything agents read comes from here: baseline pages (as synced from Confluence into the
 * database) and the live Jira backlog. Agents never fetch anything themselves.
 */
export function createContextBuilder(opts: {
  db: Db;
  atlassian?: AtlassianGateway;
  jiraProjectKey?: string;
}) {
  const { db, atlassian, jiraProjectKey } = opts;

  return {
    /** Plain text of baseline pages by type, e.g. game_design_document. */
    async baselineTexts(projectId: string | null, types: string[]): Promise<Record<string, string>> {
      if (!projectId) return {};
      const rows = await db
        .select({
          type: baselineArtifacts.type,
          title: baselineArtifacts.title,
          text: baselineArtifacts.contentText,
        })
        .from(baselineArtifacts)
        .where(and(eq(baselineArtifacts.projectId, projectId), inArray(baselineArtifacts.type, types)));
      return Object.fromEntries(rows.map((r) => [r.type, `## ${r.title}\n\n${r.text}`]));
    },

    /** Component names and change sensitivity from the Architecture Overview. */
    async components(projectId: string | null): Promise<{ name: string; sensitivity: Sensitivity }[]> {
      if (!projectId) return [];
      const [row] = await db
        .select({ data: baselineArtifacts.data })
        .from(baselineArtifacts)
        .where(
          and(
            eq(baselineArtifacts.projectId, projectId),
            eq(baselineArtifacts.type, 'architecture_overview'),
          ),
        );
      const data = row?.data as { components?: { name: string; sensitivity: Sensitivity }[] } | null;
      return data?.components?.map(({ name, sensitivity }) => ({ name, sensitivity })) ?? [];
    },

    /** The current Jira backlog, one line per epic or story. */
    async backlog(): Promise<string> {
      if (!atlassian || !jiraProjectKey) return '(Jira is not configured; no backlog available)';
      try {
        const issues = await atlassian.jira.searchBacklog(
          `project = "${jiraProjectKey}" AND issuetype in (Epic, Story) ORDER BY key ASC`,
        );
        if (issues.length === 0) return '(the backlog is empty)';
        return issues
          .map((i) => {
            const parts = [`${i.key} [${i.type}, ${i.status}] ${i.summary}`];
            if (i.components.length) parts.push(`(${i.components.join(', ')})`);
            if (i.parent) parts.push(`epic ${i.parent}`);
            return parts.join(' ');
          })
          .join('\n');
      } catch (err) {
        return `(backlog not available: ${err instanceof Error ? err.message : String(err)})`;
      }
    },
  };
}

export type ContextBuilder = ReturnType<typeof createContextBuilder>;
