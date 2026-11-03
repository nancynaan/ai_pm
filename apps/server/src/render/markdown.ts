import { lexer, type MarkedToken, type Token, type Tokens } from 'marked';

/**
 * One Markdown source, two targets: Confluence storage format (pages) and Atlassian Document
 * Format (Jira descriptions). Both renderers walk the same marked token tree and support the
 * subset the pipeline writes: headings, paragraphs, lists, tables, code blocks, quotes, rules,
 * bold, italic, strikethrough, inline code and links.
 */
export function parseMarkdown(markdown: string): Token[] {
  return lexer(markdown, { gfm: true });
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** marked keeps entities typed in the source; decode them so renderers can escape exactly once. */
export function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** Inline content of a list item, whether marked produced tight (`text`) or loose (`paragraph`) items. */
export function listItemBlocks(item: Tokens.ListItem): Token[] {
  return item.tokens.filter((t) => t.type !== 'checkbox');
}

export type { MarkedToken, Token, Tokens };
