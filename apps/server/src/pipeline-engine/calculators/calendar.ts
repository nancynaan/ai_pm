/**
 * The sprint calendar and parsing of the client's free-text dates and amounts. Sprint 1 starts on
 * the kickoff date; every sprint is `weeks` long and ends the day before the next one starts.
 */

const DAY = 24 * 60 * 60 * 1000;

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function sprintStart(kickoff: string, sprint: number, weeks = 2): string {
  return isoDate(new Date(utc(kickoff).getTime() + (sprint - 1) * weeks * 7 * DAY));
}

export function sprintEnd(kickoff: string, sprint: number, weeks = 2): string {
  return isoDate(new Date(utc(sprintStart(kickoff, sprint + 1, weeks)).getTime() - DAY));
}

/** Whole months from `from` to the month of `to` (both ISO dates). */
export const monthsBetween = (from: string, to: string) => {
  const a = utc(from);
  const b = utc(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
};

export function addMonths(iso: string, months: number): string {
  const d = utc(iso);
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const month = (name: string) => MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3)));

/**
 * A date in the client's words: "2027-07-01", "1 July 2027", "July 1, 2027", or "July 2027"
 * (the last day of that month). Null when the text has no explicit date, e.g. "Halloween update".
 */
export function parseDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const name = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  const build = (y: string, m: string, d: number) => {
    const index = month(m);
    if (index < 0) return null;
    return isoDate(new Date(Date.UTC(Number(y), index, d)));
  };
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${name}\\s+(\\d{4})\\b`, 'i').exec(text);
  if (dmy) return build(dmy[3]!, dmy[2]!, Number(dmy[1]));
  const mdy = new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i').exec(text);
  if (mdy) return build(mdy[3]!, mdy[1]!, Number(mdy[2]));
  const my = new RegExp(`\\b${name}\\s+(\\d{4})\\b`, 'i').exec(text);
  if (my) {
    const index = month(my[1]!);
    if (index >= 0) return isoDate(new Date(Date.UTC(Number(my[2]), index + 1, 0)));
  }
  return null;
}

/** An amount in USD: "$50,000", "50k", "USD 120 000", "1.2m". Null when none is given. */
export function parseMoney(text: string): number | null {
  const match = /(?:\$|usd\s*)?\s*(\d{1,3}(?:[ ,]\d{3})+|\d+(?:\.\d+)?)\s*(k|m|thousand|million)?\b/i.exec(
    text,
  );
  if (!match) return null;
  const value = Number(match[1]!.replace(/[ ,]/g, ''));
  const unit = match[2]?.toLowerCase();
  const factor =
    unit === 'k' || unit === 'thousand' ? 1_000 : unit === 'm' || unit === 'million' ? 1_000_000 : 1;
  const amount = value * factor;
  return amount >= 100 ? amount : null;
}
