export interface Column<T> {
  header: string;
  value: (row: T) => string | number;
}

const cell = (value: string | number) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** A GitHub-flavoured Markdown table; renders to Confluence and ADF tables. */
export function markdownTable<T>(rows: readonly T[], columns: Column<T>[]): string {
  return [
    `| ${columns.map((c) => cell(c.header)).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((c) => cell(c.value(row))).join(' | ')} |`),
  ].join('\n');
}

export const formatUsd = (amount: number, fractionDigits = 0) =>
  `$${amount.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;

export const formatPercent = (ratio: number, fractionDigits = 0) =>
  `${(ratio * 100).toFixed(fractionDigits)} %`;

export const formatInt = (n: number) => n.toLocaleString('en-US');
