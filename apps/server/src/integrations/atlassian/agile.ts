import { z } from 'zod';
import type { AtlassianHttp } from './http.js';

const boardSchema = z.object({ id: z.number(), name: z.string(), type: z.string() });
export type JiraBoard = z.infer<typeof boardSchema>;

const boardPageSchema = z.object({ values: z.array(boardSchema) });

const boardConfigSchema = z.object({
  estimation: z
    .object({
      type: z.string(),
      field: z.object({ fieldId: z.string(), displayName: z.string() }).optional(),
    })
    .optional(),
});

export function agileApi(http: AtlassianHttp) {
  return {
    async findBoards(projectKey: string): Promise<JiraBoard[]> {
      const page = boardPageSchema.parse(
        await http.get('/rest/agile/1.0/board', { query: { projectKeyOrId: projectKey } }),
      );
      return page.values;
    },

    /** The field the board estimates with (usually "Story point estimate"), if any. */
    async getEstimationField(boardId: number) {
      const config = boardConfigSchema.parse(
        await http.get(`/rest/agile/1.0/board/${boardId}/configuration`),
      );
      return config.estimation?.field ?? null;
    },
  };
}

export type AgileApi = ReturnType<typeof agileApi>;
