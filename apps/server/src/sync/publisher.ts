import { createHash } from 'node:crypto';
import type { WriteMode } from '../config.js';
import { AtlassianError, type AtlassianGateway } from '../integrations/atlassian/index.js';
import type { SyncLogStore } from './sync-log.js';

export type SyncAction = 'created' | 'updated' | 'unchanged' | 'would create' | 'would update';

export interface SyncResult {
  kind: 'field' | 'component' | 'issue' | 'page';
  label: string;
  action: SyncAction;
  /** Jira issue key, component/field id or Confluence page id; a placeholder in dry-run. */
  externalId: string;
  url?: string;
  note?: string;
}

export type StatusTarget = 'todo' | 'in_progress' | 'done';
const STATUS_CATEGORY: Record<StatusTarget, string> = {
  todo: 'new',
  in_progress: 'indeterminate',
  done: 'done',
};

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Placeholder ids stand in for entities that would be created in dry-run. */
export const isPlaceholder = (id: string | undefined) => !id || id.startsWith('(new ');
const placeholder = (key: string) => `(new ${key})`;

export interface PublisherOptions {
  gateway: AtlassianGateway;
  store: SyncLogStore;
  mode: WriteMode;
  jiraProjectKey: string;
}

/**
 * Idempotent writes to Jira and Confluence. Each entity has our own key; the sync log remembers
 * its external id and the hash of what we last wrote. Unchanged payloads are skipped (so edits
 * people made in Jira or Confluence survive a re-run), and in dry-run nothing is written at all:
 * reads still happen, so the report shows exactly what a live run would do.
 */
export function createPublisher({ gateway, store, mode, jiraProjectKey }: PublisherOptions) {
  const live = mode === 'live';
  const results: SyncResult[] = [];
  const record = (result: SyncResult) => {
    results.push(result);
    return result;
  };
  const issueUrl = (key: string) => `${gateway.siteUrl}/browse/${key}`;
  const pageUrl = (id: string) => `${gateway.siteUrl}/wiki/pages/viewpage.action?pageId=${id}`;

  /** Retries once without optional fields Jira refuses (e.g. a field missing from the screen). */
  async function withOptionalFields<T>(
    fields: Record<string, unknown>,
    optional: string[],
    write: (fields: Record<string, unknown>) => Promise<T>,
  ): Promise<{ value: T; dropped: string[] }> {
    try {
      return { value: await write(fields), dropped: [] };
    } catch (err) {
      const dropped = optional.filter(
        (f) => err instanceof AtlassianError && err.status === 400 && err.message.includes(f),
      );
      if (dropped.length === 0) throw err;
      const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => !dropped.includes(k)));
      return { value: await write(rest), dropped };
    }
  }

  return {
    results,

    /** A global number custom field, placed on every screen of the project. */
    async ensureNumberField(name: string, description: string, projectId: string) {
      const idempotencyKey = `jira:field:${name}`;
      let field = (await gateway.jira.listFields()).find((f) => f.custom && f.name === name);
      let action: SyncAction = field ? 'unchanged' : live ? 'created' : 'would create';
      if (!field && live) field = await gateway.jira.createNumberField(name, description);

      const screenIds = await gateway.jira.projectScreenIds(projectId);
      let screensToAdd = 0;
      for (const screenId of screenIds) {
        if (!field) {
          screensToAdd++;
          continue;
        }
        const state = await gateway.jira.screenFieldState(screenId, field.id);
        if (state.present || !state.firstTabId) continue;
        screensToAdd++;
        if (live) await gateway.jira.addFieldToScreen(screenId, state.firstTabId, field.id);
      }
      if (action === 'unchanged' && screensToAdd > 0) action = live ? 'updated' : 'would update';
      if (live && field) {
        await store.save({
          idempotencyKey,
          system: 'jira',
          entityType: 'field',
          externalId: field.id,
          lastAction: action,
        });
      }
      const verb = live ? 'added to' : 'to add to';
      record({
        kind: 'field',
        label: `Custom field "${name}"`,
        action,
        externalId: field?.id ?? placeholder(name),
        note:
          screensToAdd > 0
            ? `${verb} ${screensToAdd} of ${screenIds.length} screens`
            : `on all ${screenIds.length} screens`,
      });
      return field?.id;
    },

    async ensureComponents(items: { name: string; description: string }[]) {
      const existing = new Map((await gateway.jira.listComponents(jiraProjectKey)).map((c) => [c.name, c]));
      for (const item of items) {
        const idempotencyKey = `jira:component:${jiraProjectKey}:${item.name}`;
        let component = existing.get(item.name);
        const action: SyncAction = component ? 'unchanged' : live ? 'created' : 'would create';
        if (!component && live)
          component = await gateway.jira.createComponent(jiraProjectKey, item.name, item.description);
        if (live && component) {
          await store.save({
            idempotencyKey,
            system: 'jira',
            entityType: 'component',
            externalId: component.id,
            lastAction: action,
          });
        }
        record({
          kind: 'component',
          label: `Component "${item.name}"`,
          action,
          externalId: component?.id ?? placeholder(item.name),
        });
      }
    },

    /**
     * Creates or updates an issue. `marker` is a label unique to this issue, used to find it again
     * when the sync log has no entry (for example after the database was reset).
     */
    async upsertIssue(input: {
      key: string;
      marker: string;
      label: string;
      fields: Record<string, unknown>;
      optionalFields?: string[];
    }): Promise<SyncResult> {
      const idempotencyKey = `jira:issue:${input.key}`;
      const payloadHash = hash(input.fields);
      const entry = await store.get(idempotencyKey);
      let issueKey = entry?.externalKey ?? undefined;
      issueKey ??= (
        await gateway.jira.search(`project = "${jiraProjectKey}" AND labels = "${input.marker}"`)
      )[0]?.key;

      const base = { kind: 'issue' as const, label: input.label };
      if (issueKey && entry?.payloadHash === payloadHash) {
        return record({ ...base, action: 'unchanged', externalId: issueKey, url: issueUrl(issueKey) });
      }
      if (!live) {
        return issueKey
          ? record({ ...base, action: 'would update', externalId: issueKey, url: issueUrl(issueKey) })
          : record({ ...base, action: 'would create', externalId: placeholder(input.key) });
      }

      let action: SyncAction;
      let dropped: string[];
      let issueId = entry?.externalId ?? null;
      if (issueKey) {
        // Project and issue type cannot change on edit.
        const editable = Object.fromEntries(
          Object.entries(input.fields).filter(([k]) => k !== 'project' && k !== 'issuetype'),
        );
        const existingKey = issueKey;
        ({ dropped } = await withOptionalFields(editable, input.optionalFields ?? [], (f) =>
          gateway.jira.updateIssue(existingKey, f),
        ));
        action = 'updated';
      } else {
        const created = await withOptionalFields(input.fields, input.optionalFields ?? [], (f) =>
          gateway.jira.createIssue(f),
        );
        issueKey = created.value.key;
        issueId = created.value.id;
        dropped = created.dropped;
        action = 'created';
      }
      await store.save({
        idempotencyKey,
        system: 'jira',
        entityType: 'issue',
        externalId: issueId,
        externalKey: issueKey,
        payloadHash,
        lastAction: action,
      });
      return record({
        ...base,
        action,
        externalId: issueKey,
        url: issueUrl(issueKey),
        note: dropped.length ? `Jira refused ${dropped.join(', ')}; left empty` : undefined,
      });
    },

    /** Moves an issue to the status category, if a transition leads there. */
    async ensureStatus(
      issueKey: string,
      target: StatusTarget,
    ): Promise<'changed' | 'unchanged' | 'would change' | 'no transition'> {
      if (isPlaceholder(issueKey)) return target === 'todo' ? 'unchanged' : 'would change';
      const category = STATUS_CATEGORY[target];
      if ((await gateway.jira.getStatusCategory(issueKey)) === category) return 'unchanged';
      if (!live) return 'would change';
      const transition = (await gateway.jira.listTransitions(issueKey)).find(
        (t) => t.to.statusCategory.key === category,
      );
      if (!transition) return 'no transition';
      await gateway.jira.transitionIssue(issueKey, transition.id);
      return 'changed';
    },

    /**
     * Creates or updates a page, found by the sync log and then by title, so it is never created
     * twice. By default an unchanged payload is skipped, which keeps edits made in Confluence;
     * `overwrite` also rewrites a page someone edited since our last write.
     */
    async upsertPage(input: {
      key: string;
      spaceId: string;
      parentId?: string;
      title: string;
      storage: string;
      labels: string[];
      overwrite?: boolean;
    }): Promise<SyncResult & { version: number | null }> {
      const idempotencyKey = `confluence:page:${input.key}`;
      const parentId = isPlaceholder(input.parentId) ? undefined : input.parentId;
      const payloadHash = hash({ title: input.title, parentId, storage: input.storage });
      const entry = await store.get(idempotencyKey);
      let page = entry?.externalId ? await gateway.confluence.getPage(entry.externalId) : null;
      page ??= await gateway.confluence.findPageByTitle(input.spaceId, input.title);

      const base = { kind: 'page' as const, label: input.title };
      const editedSince =
        input.overwrite &&
        page &&
        entry?.externalVersion != null &&
        page.version.number !== entry.externalVersion;
      if (page && entry?.externalId === page.id && entry.payloadHash === payloadHash && !editedSince) {
        return {
          ...record({ ...base, action: 'unchanged', externalId: page.id, url: pageUrl(page.id) }),
          version: page.version.number,
        };
      }
      if (!live) {
        const result = page
          ? record({ ...base, action: 'would update', externalId: page.id, url: pageUrl(page.id) })
          : record({ ...base, action: 'would create', externalId: placeholder(input.key) });
        return { ...result, version: page?.version.number ?? null };
      }

      const content = { parentId, title: input.title, storage: input.storage };
      const saved = page
        ? await gateway.confluence.updatePage(page.id, page.version.number + 1, content)
        : await gateway.confluence.createPage({ spaceId: input.spaceId, ...content });
      await gateway.confluence.addLabels(saved.id, input.labels);
      const action: SyncAction = page ? 'updated' : 'created';
      await store.save({
        idempotencyKey,
        system: 'confluence',
        entityType: 'page',
        externalId: saved.id,
        externalVersion: saved.version.number,
        payloadHash,
        lastAction: action,
      });
      return {
        ...record({ ...base, action, externalId: saved.id, url: pageUrl(saved.id) }),
        version: saved.version.number,
      };
    },

    /**
     * Writes our block on a shared page (Risk Register, Assumption Log) between two anchors: the
     * block is replaced on a re-run, appended the first time, and the rest of the page is left
     * exactly as it is. Written only when the page would change.
     */
    async upsertPageBlock(input: {
      key: string;
      pageId: string;
      blockId: string;
      storage: string;
      label: string;
    }): Promise<SyncResult & { version: number | null }> {
      const base = { kind: 'page' as const, label: input.label };
      const page = await gateway.confluence.getPage(input.pageId);
      if (!page) {
        return {
          ...record({
            ...base,
            action: 'unchanged',
            externalId: input.pageId,
            note: 'shared page not found in Confluence',
          }),
          version: null,
        };
      }
      const current = page.body?.storage?.value ?? '';
      const next = spliceBlock(current, input.blockId, input.storage);
      const url = pageUrl(page.id);
      // Confluence normalises stored markup, so compare with what we wrote last: same block and
      // nobody changed the page since our write → nothing to do.
      const entry = await store.get(`confluence:block:${input.key}`);
      const untouched =
        entry?.payloadHash === hash(input.storage) && entry.externalVersion === page.version.number;
      if (next === current || untouched) {
        return {
          ...record({ ...base, action: 'unchanged', externalId: page.id, url }),
          version: page.version.number,
        };
      }
      if (!live) {
        return {
          ...record({ ...base, action: 'would update', externalId: page.id, url }),
          version: page.version.number,
        };
      }
      const saved = await gateway.confluence.updatePage(page.id, page.version.number + 1, {
        parentId: page.parentId ?? undefined,
        title: page.title,
        storage: next,
      });
      await store.save({
        idempotencyKey: `confluence:block:${input.key}`,
        system: 'confluence',
        entityType: 'page_block',
        externalId: saved.id,
        externalVersion: saved.version.number,
        payloadHash: hash(input.storage),
        lastAction: 'updated',
      });
      return {
        ...record({ ...base, action: 'updated', externalId: saved.id, url }),
        version: saved.version.number,
      };
    },
  };
}

const blockAnchor = (blockId: string, edge: 'start' | 'end') =>
  `<ac:structured-macro ac:name="anchor" ac:schema-version="1"><ac:parameter ac:name="">${blockId}-${edge}</ac:parameter></ac:structured-macro>`;

/**
 * Replaces the block between `<blockId>-start` and `<blockId>-end` anchors, or appends it.
 * Confluence adds attributes (ac:macro-id) to macros it stores, so the anchors are matched
 * by their name parameter, not by the exact markup we wrote.
 */
export function spliceBlock(page: string, blockId: string, block: string): string {
  const id = blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchor = (edge: string) =>
    `<ac:structured-macro\\b[^>]*ac:name="anchor"[^>]*>\\s*<ac:parameter ac:name="">${id}-${edge}</ac:parameter>\\s*</ac:structured-macro>`;
  const wrapped = `${blockAnchor(blockId, 'start')}${block}${blockAnchor(blockId, 'end')}`;
  // An anchor may sit inside a <p> after Confluence normalises the page; take the paragraph too.
  const pattern = new RegExp(
    `(?:<p>\\s*)?${anchor('start')}(?:\\s*</p>)?[\\s\\S]*?(?:<p>\\s*)?${anchor('end')}(?:\\s*</p>)?`,
  );
  if (pattern.test(page)) {
    const existing = page.match(pattern)![0];
    // Same content (ignoring Confluence's added attributes) → leave the page untouched.
    const strip = (s: string) => s.replace(/\sac:macro-id="[^"]*"/g, '').replace(/<\/?p>/g, '');
    if (strip(existing) === strip(wrapped)) return page;
    return page.replace(pattern, () => wrapped);
  }
  return `${page}${wrapped}`;
}

export type Publisher = ReturnType<typeof createPublisher>;
