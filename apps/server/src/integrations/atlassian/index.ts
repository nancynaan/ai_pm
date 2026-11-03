import { agileApi } from './agile.js';
import { confluenceApi } from './confluence.js';
import { type AtlassianCredentials, type AtlassianHttpOptions, createAtlassianHttp } from './http.js';
import { jiraApi } from './jira.js';

export { AtlassianError, type AtlassianCredentials, ReadOnlyViolation } from './http.js';

/** Typed access to Jira, the Jira Agile API and Confluence. Grows with each pipeline phase. */
export function createAtlassianGateway(credentials: AtlassianCredentials, options?: AtlassianHttpOptions) {
  const http = createAtlassianHttp(credentials, options);
  return {
    siteUrl: http.siteUrl,
    readOnly: http.readOnly,
    jira: jiraApi(http),
    agile: agileApi(http),
    confluence: confluenceApi(http),
  };
}

export type AtlassianGateway = ReturnType<typeof createAtlassianGateway>;
