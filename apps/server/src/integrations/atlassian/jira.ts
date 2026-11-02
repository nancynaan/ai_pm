import { z } from 'zod';
import type { AtlassianHttp } from './http.js';

const myselfSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  emailAddress: z.string().optional(),
});

const projectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  projectTypeKey: z.string(),
  /** `classic` = company-managed, `next-gen` = team-managed. */
  style: z.string().optional(),
});
export type JiraProject = z.infer<typeof projectSchema>;

export function jiraApi(http: AtlassianHttp) {
  return {
    async getMyself() {
      return myselfSchema.parse(await http.get('/rest/api/3/myself'));
    },
    async getProject(key: string) {
      return projectSchema.parse(await http.get(`/rest/api/3/project/${encodeURIComponent(key)}`));
    },
  };
}
