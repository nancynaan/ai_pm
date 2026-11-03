import { Fragment, type ReactNode } from 'react';

/** Tiny, safe renderer for chat text: paragraphs, "- " lists and **bold**. No HTML is injected. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

export function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        const [first, ...rest] = lines;
        if (rest.length && rest.every((l) => l.startsWith('- '))) {
          return (
            <Fragment key={i}>
              <p>{inline(first ?? '')}</p>
              <ul>
                {rest.map((l, j) => (
                  <li key={j}>{inline(l.slice(2))}</li>
                ))}
              </ul>
            </Fragment>
          );
        }
        return <p key={i}>{lines.map((l, j) => (j ? [<br key={j} />, ...inline(l)] : inline(l)))}</p>;
      })}
    </>
  );
}
