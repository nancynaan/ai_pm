import { parse } from 'yaml';
import { z } from 'zod';

/** Splits `---\n<yaml>\n---\n<body>` and validates the YAML part. */
export function parseFrontMatter<T extends z.ZodType>(
  source: string,
  schema: T,
  file: string,
): { data: z.infer<T>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match?.[1] || match[2] === undefined) throw new Error(`${file}: missing YAML front matter`);
  const parsed = schema.safeParse(parse(match[1]));
  if (!parsed.success) throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`);
  return { data: parsed.data, body: match[2].trim() };
}
