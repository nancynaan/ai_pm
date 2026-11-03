import { z } from 'zod';
import { AtlassianError, type AtlassianHttp } from './http.js';

const spaceSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  homepageId: z.string().nullish(),
});
export type ConfluenceSpace = z.infer<typeof spaceSchema>;

const spacePageSchema = z.object({ results: z.array(spaceSchema) });

const pageSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullish(),
  version: z.object({ number: z.number() }),
  body: z.object({ storage: z.object({ value: z.string() }).optional() }).optional(),
});
export type ConfluencePage = z.infer<typeof pageSchema>;

const pageListSchema = z.object({ results: z.array(pageSchema) });

export interface PageInput {
  spaceId: string;
  parentId?: string;
  title: string;
  /** Confluence storage format (XHTML). */
  storage: string;
}

export function confluenceApi(http: AtlassianHttp) {
  const body = (storage: string) => ({ representation: 'storage', value: storage });

  return {
    /** Null when the space does not exist or the token's user cannot see it. */
    async getSpaceByKey(key: string): Promise<ConfluenceSpace | null> {
      const page = spacePageSchema.parse(await http.get('/wiki/api/v2/spaces', { query: { keys: key } }));
      return page.results[0] ?? null;
    },

    /** Titles are unique within a space, so the title is a natural key. */
    async findPageByTitle(spaceId: string, title: string): Promise<ConfluencePage | null> {
      const list = pageListSchema.parse(
        await http.get('/wiki/api/v2/pages', {
          query: { 'space-id': spaceId, title, status: 'current', 'body-format': 'storage' },
        }),
      );
      return list.results[0] ?? null;
    },

    async getPage(id: string): Promise<ConfluencePage | null> {
      try {
        return pageSchema.parse(
          await http.get(`/wiki/api/v2/pages/${id}`, { query: { 'body-format': 'storage' } }),
        );
      } catch (err) {
        if (err instanceof AtlassianError && err.status === 404) return null;
        throw err;
      }
    },

    async createPage({ spaceId, parentId, title, storage }: PageInput): Promise<ConfluencePage> {
      return pageSchema.parse(
        await http.post('/wiki/api/v2/pages', {
          body: { spaceId, status: 'current', title, parentId, body: body(storage) },
        }),
      );
    },

    async updatePage(id: string, version: number, { parentId, title, storage }: Omit<PageInput, 'spaceId'>) {
      return pageSchema.parse(
        await http.put(`/wiki/api/v2/pages/${id}`, {
          body: {
            id,
            status: 'current',
            title,
            parentId,
            body: body(storage),
            version: { number: version, message: 'Updated by AI PM' },
          },
        }),
      );
    },

    /** v2 has no label endpoint for writes; adding an existing label is a no-op. */
    async addLabels(pageId: string, labels: string[]) {
      if (labels.length === 0) return;
      await http.post(`/wiki/rest/api/content/${pageId}/label`, {
        body: labels.map((name) => ({ prefix: 'global', name })),
      });
    },
  };
}

export type ConfluenceApi = ReturnType<typeof confluenceApi>;
