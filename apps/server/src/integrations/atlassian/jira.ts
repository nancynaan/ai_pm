import { z } from 'zod';
import type { AtlassianHttp } from './http.js';

// Jira returns some ids as strings and others as numbers; normalise to strings.
const id = z.union([z.string(), z.number()]).transform(String);

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
  issueTypes: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
export type JiraProject = z.infer<typeof projectSchema>;

const fieldSchema = z.object({ id: z.string(), name: z.string(), custom: z.boolean().optional() });
export type JiraField = z.infer<typeof fieldSchema>;

const componentSchema = z.object({ id: z.string(), name: z.string() });
export type JiraComponent = z.infer<typeof componentSchema>;

const issueRefSchema = z.object({ id: z.string(), key: z.string() });
export type JiraIssueRef = z.infer<typeof issueRefSchema>;

const searchSchema = z.object({ issues: z.array(issueRefSchema) });

const statusCategory = z.object({ key: z.string() });
const issueStatusSchema = z.object({
  fields: z.object({ status: z.object({ name: z.string(), statusCategory }) }),
});
const transitionsSchema = z.object({
  transitions: z.array(
    z.object({ id: z.string(), name: z.string(), to: z.object({ name: z.string(), statusCategory }) }),
  ),
});
export type JiraTransition = z.infer<typeof transitionsSchema>['transitions'][number];

const valuesOf = <T extends z.ZodType>(item: T) => z.object({ values: z.array(item) });
const projectSchemeSchema = valuesOf(z.object({ issueTypeScreenScheme: z.object({ id }) }));
const schemeMappingSchema = valuesOf(z.object({ screenSchemeId: id }));
const screenSchemeSchema = valuesOf(z.object({ screens: z.record(z.string(), id) }));
const tabsSchema = z.array(z.object({ id, name: z.string() }));
const tabFieldsSchema = z.array(z.object({ id: z.string() }));

export function jiraApi(http: AtlassianHttp) {
  const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

  return {
    async getMyself() {
      return myselfSchema.parse(await http.get('/rest/api/3/myself'));
    },

    async getProject(key: string) {
      return projectSchema.parse(await http.get(`/rest/api/3/project/${encodeURIComponent(key)}`));
    },

    async listFields(): Promise<JiraField[]> {
      return z.array(fieldSchema).parse(await http.get('/rest/api/3/field'));
    },

    /** Creates a global number field (all projects, all issue types). */
    async createNumberField(name: string, description: string): Promise<JiraField> {
      const body = {
        name,
        description,
        type: 'com.atlassian.jira.plugin.system.customfieldtypes:float',
        searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:exactnumber',
      };
      return fieldSchema.parse(await http.post('/rest/api/3/field', { body }));
    },

    /** Every screen the project's issue types use (create, edit, view, default). */
    async projectScreenIds(projectId: string): Promise<string[]> {
      const schemes = projectSchemeSchema.parse(
        await http.get('/rest/api/3/issuetypescreenscheme/project', { query: { projectId } }),
      );
      const schemeId = schemes.values[0]?.issueTypeScreenScheme.id;
      if (!schemeId) return [];
      const mapping = schemeMappingSchema.parse(
        await http.get('/rest/api/3/issuetypescreenscheme/mapping', {
          query: { issueTypeScreenSchemeId: schemeId },
        }),
      );
      const screenIds = new Set<string>();
      for (const screenSchemeId of new Set(mapping.values.map((m) => m.screenSchemeId))) {
        const screenSchemes = screenSchemeSchema.parse(
          await http.get('/rest/api/3/screenscheme', { query: { id: screenSchemeId } }),
        );
        for (const scheme of screenSchemes.values) {
          for (const screenId of Object.values(scheme.screens)) screenIds.add(screenId);
        }
      }
      return [...screenIds];
    },

    /** The screen's first tab, and whether the field is already on any tab. */
    async screenFieldState(screenId: string, fieldId: string) {
      const tabs = tabsSchema.parse(await http.get(`/rest/api/3/screens/${screenId}/tabs`));
      let present = false;
      for (const tab of tabs) {
        const fields = tabFieldsSchema.parse(
          await http.get(`/rest/api/3/screens/${screenId}/tabs/${tab.id}/fields`),
        );
        if (fields.some((f) => f.id === fieldId)) present = true;
      }
      return { firstTabId: tabs[0]?.id, present };
    },

    async addFieldToScreen(screenId: string, tabId: string, fieldId: string) {
      await http.post(`/rest/api/3/screens/${screenId}/tabs/${tabId}/fields`, { body: { fieldId } });
    },

    async listComponents(projectKey: string): Promise<JiraComponent[]> {
      return z
        .array(componentSchema)
        .parse(await http.get(`/rest/api/3/project/${encodeURIComponent(projectKey)}/components`));
    },

    async createComponent(projectKey: string, name: string, description: string): Promise<JiraComponent> {
      return componentSchema.parse(
        await http.post('/rest/api/3/component', { body: { project: projectKey, name, description } }),
      );
    },

    async search(jql: string): Promise<JiraIssueRef[]> {
      const body = { jql, fields: ['summary'], maxResults: 100 };
      return searchSchema.parse(await http.post('/rest/api/3/search/jql', { body })).issues;
    },

    async createIssue(fields: Record<string, unknown>): Promise<JiraIssueRef> {
      return issueRefSchema.parse(await http.post('/rest/api/3/issue', { body: { fields } }));
    },

    async updateIssue(key: string, fields: Record<string, unknown>) {
      await http.put(issuePath(key), { body: { fields } });
    },

    /** Status category key: `new`, `indeterminate` (in progress) or `done`. */
    async getStatusCategory(key: string): Promise<string> {
      const issue = issueStatusSchema.parse(await http.get(issuePath(key), { query: { fields: 'status' } }));
      return issue.fields.status.statusCategory.key;
    },

    async listTransitions(key: string): Promise<JiraTransition[]> {
      return transitionsSchema.parse(await http.get(`${issuePath(key)}/transitions`)).transitions;
    },

    async transitionIssue(key: string, transitionId: string) {
      await http.post(`${issuePath(key)}/transitions`, { body: { transition: { id: transitionId } } });
    },
  };
}

export type JiraApi = ReturnType<typeof jiraApi>;
