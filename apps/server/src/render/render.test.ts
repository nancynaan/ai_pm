import { describe, expect, it } from 'vitest';
import { markdownToAdf } from './adf.js';
import { markdownToStorage, storageToText } from './storage.js';
import { formatPercent, formatUsd, markdownTable } from './tables.js';

describe('markdownToStorage', () => {
  it('renders headings, inline marks and escaped text', () => {
    expect(
      markdownToStorage(
        '## Goal\n\nTom & Jerry use **bold**, _em_, `a<b>` and [docs](https://e.com/?a=1&b=2)',
      ),
    ).toBe(
      '<h2>Goal</h2><p>Tom &amp; Jerry use <strong>bold</strong>, <em>em</em>, <code>a&lt;b&gt;</code> and <a href="https://e.com/?a=1&amp;b=2">docs</a></p>',
    );
  });

  it('renders lists and tables, including escaped pipes in cells', () => {
    const md = `- one\n- two\n\n${markdownTable(
      [{ a: 'x | y', b: 2 }],
      [
        { header: 'A', value: (r) => r.a },
        { header: 'B', value: (r) => r.b },
      ],
    )}`;
    expect(markdownToStorage(md)).toBe(
      '<ul><li>one</li><li>two</li></ul><table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x | y</td><td>2</td></tr></tbody></table>',
    );
  });

  it('turns code blocks into the code macro and {{children}} into the children macro', () => {
    const storage = markdownToStorage('```gherkin\nGiven a ]]> b\n```\n\n{{children}}');
    expect(storage).toContain('<ac:structured-macro ac:name="code"');
    expect(storage).not.toContain('ac:name="language"'); // gherkin is not a Confluence language
    expect(storage).toContain('<![CDATA[Given a ]]]]><![CDATA[> b]]>');
    expect(storage).toContain('<ac:structured-macro ac:name="children" ac:schema-version="2" />');
  });

  it('round-trips to readable text for prompts', () => {
    const storage = markdownToStorage(
      '# Risks\n\n| ID | Risk |\n|---|---|\n| R-01 | Low retention |\n\n- a & b',
    );
    expect(storageToText(storage)).toBe('Risks\nID | Risk\nR-01 | Low retention\n- a & b');
  });
});

describe('markdownToAdf', () => {
  it('builds an ADF document with marks, lists and code blocks', () => {
    const doc = markdownToAdf(
      'As a **player** I want [coins](https://e.com)\n\n- one\n\n```gherkin\nGiven x\n```',
    );
    expect(doc).toEqual({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'As a ' },
            { type: 'text', text: 'player', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' I want ' },
            { type: 'text', text: 'coins', marks: [{ type: 'link', attrs: { href: 'https://e.com' } }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'gherkin' }, content: [{ type: 'text', text: 'Given x' }] },
      ],
    });
  });

  it('builds tables with header cells', () => {
    const doc = markdownToAdf('| A |\n|---|\n| 1 |');
    expect(doc.content[0]?.type).toBe('table');
    expect(doc.content[0]?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(doc.content[0]?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
  });
});

describe('formatters', () => {
  it('formats money and percentages', () => {
    expect(formatUsd(38600)).toBe('$38,600');
    expect(formatUsd(0.06, 2)).toBe('$0.06');
    expect(formatPercent(0.385, 1)).toBe('38.5 %');
  });
});
