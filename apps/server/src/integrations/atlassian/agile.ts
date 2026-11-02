import { z } from 'zod';
import type { AtlassianHttp } from './http.js';

const boardSchema = z.object({ id: z.number(), name: z.string(), type: z.string() });
export type JiraBoard = z.infer<typeof boardSchema>;

const boardPageSchema = z.object({ values: z.array(boardSchema) });

export function agileApi(http: AtlassianHttp) {
  return {
    async findBoards(projectKey: string): Promise<JiraBoard[]> {
      const page = boardPageSchema.parse(
        await http.get('/rest/agile/1.0/board', { query: { projectKeyOrId: projectKey } }),
      );
      return page.values;
    },
  };
}
