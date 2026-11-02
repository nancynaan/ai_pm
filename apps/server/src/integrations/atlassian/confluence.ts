import { z } from 'zod';
import type { AtlassianHttp } from './http.js';

const spaceSchema = z.object({ id: z.string(), key: z.string(), name: z.string() });
export type ConfluenceSpace = z.infer<typeof spaceSchema>;

const spacePageSchema = z.object({ results: z.array(spaceSchema) });

export function confluenceApi(http: AtlassianHttp) {
  return {
    /** Null when the space does not exist or the token's user cannot see it. */
    async getSpaceByKey(key: string): Promise<ConfluenceSpace | null> {
      const page = spacePageSchema.parse(await http.get('/wiki/api/v2/spaces', { query: { keys: key } }));
      return page.results[0] ?? null;
    },
  };
}
