import { decodeEntities, listItemBlocks, type MarkedToken, parseMarkdown, type Token } from './markdown.js';

/** Atlassian Document Format, the JSON format of Jira Cloud rich-text fields. */
export interface AdfMark {
  type: 'strong' | 'em' | 'strike' | 'code' | 'link';
  attrs?: { href: string };
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export function markdownToAdf(markdown: string): AdfDoc {
  return { type: 'doc', version: 1, content: blocks(parseMarkdown(markdown)) };
}

function blocks(tokens: Token[]): AdfNode[] {
  return tokens.flatMap(block);
}

const paragraph = (content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });

// MarkedToken is the discriminated union of marked's own tokens, so the switch narrows properly.
function block(anyToken: Token): AdfNode[] {
  const token = anyToken as MarkedToken;
  switch (token.type) {
    case 'heading':
      return [{ type: 'heading', attrs: { level: token.depth }, content: inline(token.tokens) }];
    case 'paragraph':
      return [paragraph(inline(token.tokens))];
    case 'text':
      return [paragraph(token.tokens ? inline(token.tokens) : text(token.text))];
    case 'list':
      return [
        {
          type: token.ordered ? 'orderedList' : 'bulletList',
          content: token.items.map((item) => ({ type: 'listItem', content: blocks(listItemBlocks(item)) })),
        },
      ];
    case 'table': {
      const cell = (type: string, tokens: Token[]): AdfNode => ({
        type,
        attrs: {},
        content: [paragraph(inline(tokens))],
      });
      return [
        {
          type: 'table',
          attrs: { isNumberColumnEnabled: false, layout: 'default' },
          content: [
            { type: 'tableRow', content: token.header.map((c) => cell('tableHeader', c.tokens)) },
            ...token.rows.map((row) => ({
              type: 'tableRow',
              content: row.map((c) => cell('tableCell', c.tokens)),
            })),
          ],
        },
      ];
    }
    case 'code':
      return [
        {
          type: 'codeBlock',
          attrs: token.lang ? { language: token.lang } : {},
          content: token.text ? [{ type: 'text', text: token.text }] : [],
        },
      ];
    case 'blockquote':
      return [{ type: 'blockquote', content: blocks(token.tokens) }];
    case 'hr':
      return [{ type: 'rule' }];
    case 'html':
      return [paragraph(text(token.text))];
    default:
      return [];
  }
}

function text(value: string, marks: AdfMark[] = []): AdfNode[] {
  const decoded = decodeEntities(value);
  if (!decoded) return [];
  return [marks.length ? { type: 'text', text: decoded, marks } : { type: 'text', text: decoded }];
}

function inline(tokens: Token[] = [], marks: AdfMark[] = []): AdfNode[] {
  return tokens.flatMap((anyToken): AdfNode[] => {
    const t = anyToken as MarkedToken;
    switch (t.type) {
      case 'text':
        return t.tokens ? inline(t.tokens, marks) : text(t.text, marks);
      case 'escape':
        return text(t.text, marks);
      case 'strong':
        return inline(t.tokens, [...marks, { type: 'strong' }]);
      case 'em':
        return inline(t.tokens, [...marks, { type: 'em' }]);
      case 'del':
        return inline(t.tokens, [...marks, { type: 'strike' }]);
      case 'codespan':
        return text(t.text, [...marks.filter((m) => m.type === 'link'), { type: 'code' }]);
      case 'link':
        return inline(t.tokens, [...marks, { type: 'link', attrs: { href: t.href } }]);
      case 'br':
        return [{ type: 'hardBreak' }];
      default:
        return text(t.raw, marks);
    }
  });
}
