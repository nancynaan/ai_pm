import { lexer, type MarkedToken, type Token } from 'marked';
import type { ReactNode } from 'react';

/**
 * Renders the documents' Markdown as React elements (never as raw HTML), for the in-app preview:
 * headings, paragraphs, lists, tables, quotes, code, rules, bold, italic, code spans and links.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="markdown">{blocks(lexer(source, { gfm: true }))}</div>;
}

const decode = (text: string) =>
  text.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (e) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[e] ?? e,
  );

const safeHref = (href: string) => (/^(https?:\/\/|#\/)/.test(href) ? href : undefined);

function blocks(tokens: Token[]): ReactNode[] {
  return tokens.map((anyToken, i) => {
    const t = anyToken as MarkedToken;
    switch (t.type) {
      case 'heading': {
        const level = Math.min(6, t.depth + 1);
        const Tag = `h${level}` as 'h2';
        return <Tag key={i}>{inline(t.tokens)}</Tag>;
      }
      case 'paragraph':
        return <p key={i}>{inline(t.tokens)}</p>;
      case 'text':
        return <p key={i}>{t.tokens ? inline(t.tokens) : decode(t.text)}</p>;
      case 'list': {
        const items = t.items.map((item, n) => (
          <li key={n}>
            {item.tokens.map((c, m) =>
              c.type === 'text' ? (
                <span key={m}>
                  {(c as MarkedToken & { tokens?: Token[] }).tokens
                    ? inline((c as { tokens: Token[] }).tokens)
                    : decode((c as { text: string }).text)}
                </span>
              ) : (
                <span key={m}>{blocks([c])}</span>
              ),
            )}
          </li>
        ));
        return t.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      case 'table':
        return (
          <div key={i} className="table-scroll">
            <table>
              <thead>
                <tr>
                  {t.header.map((c, n) => (
                    <th key={n}>{inline(c.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, n) => (
                      <td key={n}>{inline(c.tokens)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'blockquote':
        return <blockquote key={i}>{blocks(t.tokens)}</blockquote>;
      case 'code':
        return (
          <pre key={i}>
            <code>{t.text}</code>
          </pre>
        );
      case 'hr':
        return <hr key={i} />;
      case 'html':
        return <p key={i}>{t.text}</p>;
      default:
        return null;
    }
  });
}

function inline(tokens: Token[] = []): ReactNode[] {
  return tokens.map((anyToken, i) => {
    const t = anyToken as MarkedToken;
    switch (t.type) {
      case 'text':
        return t.tokens ? <span key={i}>{inline(t.tokens)}</span> : decode(t.text);
      case 'escape':
        return decode(t.text);
      case 'strong':
        return <strong key={i}>{inline(t.tokens)}</strong>;
      case 'em':
        return <em key={i}>{inline(t.tokens)}</em>;
      case 'del':
        return <del key={i}>{inline(t.tokens)}</del>;
      case 'codespan':
        return <code key={i}>{decode(t.text)}</code>;
      case 'link': {
        const href = safeHref(t.href);
        return href ? (
          <a key={i} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
            {inline(t.tokens)}
          </a>
        ) : (
          <span key={i}>{inline(t.tokens)}</span>
        );
      }
      case 'br':
        return <br key={i} />;
      default:
        return decode(t.raw);
    }
  });
}
