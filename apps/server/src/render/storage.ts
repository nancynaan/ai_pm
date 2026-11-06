import { decodeEntities, listItemBlocks, type MarkedToken, parseMarkdown, type Token } from './markdown.js';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Languages the Confluence code macro accepts; anything else renders as plain text.
const CODE_LANGUAGES = new Set([
  'bash',
  'java',
  'javascript',
  'js',
  'json',
  'python',
  'sql',
  'typescript',
  'xml',
  'yaml',
]);

/** A paragraph that contains only `{{children}}` becomes the Confluence "children" macro. */
const CHILDREN_MACRO = '<ac:structured-macro ac:name="children" ac:schema-version="2" />';

/**
 * `macros` replaces `{{macro:name}}` placeholders with storage XML: a paragraph holding only the
 * placeholder becomes the macro (or disappears when the macro is empty); elsewhere it is inline.
 */
export function markdownToStorage(markdown: string, macros: Record<string, string> = {}): string {
  return blocks(parseMarkdown(markdown))
    .replace(/<p>\{\{children\}\}<\/p>/g, CHILDREN_MACRO)
    .replace(/<p>\{\{macro:([a-z_]+)\}\}<\/p>/g, (all, name: string) => macros[name] ?? all)
    .replace(/\{\{macro:([a-z_]+)\}\}/g, (all, name: string) => macros[name] ?? all);
}

export const childrenMacro = () => CHILDREN_MACRO;

export function infoPanel(text: string): string {
  return panel('info', text);
}

/** Confluence panels: info (blue), note (yellow), warning (red). */
export function panel(kind: 'info' | 'note' | 'warning', text: string): string {
  return `<ac:structured-macro ac:name="${kind}" ac:schema-version="1"><ac:rich-text-body><p>${escape(text)}</p></ac:rich-text-body></ac:structured-macro>`;
}

/** The status lozenge, e.g. a green "Go". */
export function statusMacro(colour: 'Green' | 'Yellow' | 'Red' | 'Blue' | 'Grey', title: string): string {
  return `<ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="colour">${colour}</ac:parameter><ac:parameter ac:name="title">${escape(title)}</ac:parameter></ac:structured-macro>`;
}

/** An anchor; feature blocks on shared pages are marked with a start and an end anchor. */
export function anchorMacro(name: string): string {
  return `<ac:structured-macro ac:name="anchor" ac:schema-version="1"><ac:parameter ac:name="">${escape(name)}</ac:parameter></ac:structured-macro>`;
}

function blocks(tokens: Token[]): string {
  return tokens.map(block).join('');
}

// MarkedToken is the discriminated union of marked's own tokens, so the switch narrows properly.
function block(anyToken: Token): string {
  const token = anyToken as MarkedToken;
  switch (token.type) {
    case 'heading':
      return `<h${token.depth}>${inline(token.tokens)}</h${token.depth}>`;
    case 'paragraph':
      return `<p>${inline(token.tokens)}</p>`;
    case 'text':
      return `<p>${token.tokens ? inline(token.tokens) : escape(decodeEntities(token.text))}</p>`;
    case 'list': {
      const tag = token.ordered ? 'ol' : 'ul';
      const items = token.items.map((item) => `<li>${listItem(listItemBlocks(item))}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'table': {
      const head = `<tr>${token.header.map((c) => `<th>${inline(c.tokens)}</th>`).join('')}</tr>`;
      const rows = token.rows
        .map((row) => `<tr>${row.map((c) => `<td>${inline(c.tokens)}</td>`).join('')}</tr>`)
        .join('');
      return `<table><tbody>${head}${rows}</tbody></table>`;
    }
    case 'code':
      return codeMacro(token.text, token.lang);
    case 'blockquote':
      return `<blockquote>${blocks(token.tokens)}</blockquote>`;
    case 'hr':
      return '<hr />';
    case 'html':
      return `<p>${escape(token.text)}</p>`;
    default:
      return '';
  }
}

// Tight list items hold bare `text` tokens; render them without wrapping <p> for compact lists.
function listItem(tokens: Token[]): string {
  return tokens
    .map((t) =>
      t.type === 'text' ? (t.tokens ? inline(t.tokens) : escape(decodeEntities(t.text))) : block(t),
    )
    .join('');
}

function inline(tokens: Token[] = []): string {
  return tokens
    .map((anyToken) => {
      const t = anyToken as MarkedToken;
      switch (t.type) {
        case 'text':
          return t.tokens ? inline(t.tokens) : escape(decodeEntities(t.text));
        case 'escape':
          return escape(t.text);
        case 'strong':
          return `<strong>${inline(t.tokens)}</strong>`;
        case 'em':
          return `<em>${inline(t.tokens)}</em>`;
        case 'del':
          return `<del>${inline(t.tokens)}</del>`;
        case 'codespan':
          return `<code>${escape(decodeEntities(t.text))}</code>`;
        case 'link':
          return `<a href="${escape(t.href)}">${inline(t.tokens)}</a>`;
        case 'br':
          return '<br />';
        default:
          return escape(t.raw);
      }
    })
    .join('');
}

function codeMacro(code: string, lang?: string): string {
  const language =
    lang && CODE_LANGUAGES.has(lang) ? `<ac:parameter ac:name="language">${lang}</ac:parameter>` : '';
  // "]]>" cannot appear inside CDATA; split it across two sections.
  const body = code.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<ac:structured-macro ac:name="code" ac:schema-version="1">${language}<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body></ac:structured-macro>`;
}

/** Plain text of a storage-format page, for prompts: tags dropped, tables kept readable. */
export function storageToText(storage: string): string {
  return storage
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, code: string) => `\n${code}\n`)
    .replace(/<\/(p|h[1-6]|li|tr|blockquote|pre)>/g, '\n')
    .replace(/<(br|hr)\s*\/?>/g, '\n')
    .replace(/<\/(td|th)>/g, ' | ')
    .replace(/<li>/g, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (e) => decodeEntities(e))
    .replace(/ \| \n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The client deck's file name on the Feature Brief; the attachment and its embed use the same. */
export const proposalFileName = (faNumber: number | null) =>
  `${faNumber ? `FA-${faNumber} ` : ''}Feature Proposal.pptx`;

/** Confluence's file preview of a page attachment (shows the PPTX inside the page). */
export function viewFileMacro(fileName: string): string {
  return `<ac:structured-macro ac:name="view-file" ac:schema-version="1"><ac:parameter ac:name="name"><ri:attachment ri:filename="${escape(fileName)}" /></ac:parameter><ac:parameter ac:name="height">250</ac:parameter></ac:structured-macro>`;
}
