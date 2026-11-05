import { foldForSearch } from './search';
import { normalizeText } from './identity';
import { parseArticle, splitArticle } from './vocabulary';

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** UTF-8 first. Excel often saves Windows-1254 or UTF-16, which would otherwise turn ş and ß into junk. */
export function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1254').decode(bytes);
  }
}

/** RFC 4180: quoted fields, doubled quotes, and line breaks inside quotes. Rows of only blanks are dropped. */
export function parseDelimited(input: string, delimiter: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;

  const endField = () => {
    row.push(field.trim());
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (char === delimiter) {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += char;
      if (char !== ' ') fieldStart = false;
    }
  }
  endRow();
  return rows;
}

const DELIMITERS = ['\t', ';', ',', '|'] as const;

/** The delimiter giving most lines the same column count. On a tie the earlier one wins: commas are common inside meanings. */
export function detectDelimiter(text: string): string | null {
  const sample = text.split(/\r?\n/).slice(0, 50).join('\n');
  let best: { delimiter: string; share: number } | null = null;
  for (const delimiter of DELIMITERS) {
    const counts = parseDelimited(sample, delimiter).map((row) => row.length);
    if (counts.length === 0) continue;
    const frequency = new Map<number, number>();
    for (const count of counts) if (count >= 2) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    const share = Math.max(0, ...frequency.values()) / counts.length;
    if (share >= 0.8 && (!best || share > best.share)) best = { delimiter, share };
  }
  return best?.delimiter ?? null;
}

export type ColumnRole = 'german' | 'article' | 'turkish' | 'plural' | 'ignore';

export interface ColumnMapping {
  hasHeader: boolean;
  roles: ColumnRole[];
}

const HEADER_NAMES: Record<Exclude<ColumnRole, 'ignore'>, readonly string[]> = {
  german: ['almanca', 'deutsch', 'german', 'kelime', 'wort', 'word', 'lemma'],
  article: ['artikel', 'article'],
  turkish: ['turkce', 'turkisch', 'turkish', 'anlam', 'anlami', 'ceviri', 'meaning', 'translation', 'bedeutung'],
  plural: ['cogul', 'plural', 'mehrzahl'],
};

const isArticleColumn = (rows: readonly string[][], column: number) => {
  const cells = rows.map((row) => row[column] ?? '');
  return cells.some((cell) => cell !== '') && cells.every((cell) => parseArticle(cell) !== undefined);
};

/** A guess the review can correct. confident is false only when a person must choose the columns. */
export function guessColumns(rows: readonly string[][]): { mapping: ColumnMapping; confident: boolean } {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const first = rows[0] ?? [];
  const roles: ColumnRole[] = Array.from({ length: width }, () => 'ignore');

  first.forEach((cell, column) => {
    const name = foldForSearch(cell);
    for (const [role, names] of Object.entries(HEADER_NAMES) as [Exclude<ColumnRole, 'ignore'>, readonly string[]][]) {
      if (names.includes(name) && !roles.includes(role)) roles[column] = role;
    }
  });
  if (roles.includes('german') && roles.includes('turkish')) return { mapping: { hasHeader: true, roles }, confident: true };

  roles.fill('ignore');
  const articleColumn = width >= 3 ? roles.findIndex((_, column) => isArticleColumn(rows, column)) : -1;
  if (articleColumn >= 0) roles[articleColumn] = 'article';
  const rest = roles.flatMap((role, column) => (role === 'ignore' ? [column] : []));
  if (rest[0] !== undefined) roles[rest[0]] = 'german';
  if (rest[1] !== undefined) roles[rest[1]] = 'turkish';
  return { mapping: { hasHeader: false, roles }, confident: rest.length === 2 };
}

export const mappingIsComplete = (mapping: ColumnMapping): boolean => mapping.roles.includes('german') && mapping.roles.includes('turkish');

/** Assigns a role to a column. A role lives in one column, so the column that had it is released. */
export function assignRole(mapping: ColumnMapping, column: number, role: ColumnRole): ColumnMapping {
  const roles = mapping.roles.map((current, index) => (index === column ? role : current === role ? 'ignore' : current));
  return { ...mapping, roles };
}

export interface ParsedRow {
  rowIndex: number;
  german: string;
  article: string;
  turkish: string;
  plural: string;
}

/** An article column wins; otherwise der Apfel in the German column is split. An article it cannot read stays visible for correction. */
export function rowsFromTable(rows: readonly string[][], mapping: ColumnMapping): ParsedRow[] {
  const column = (role: ColumnRole) => mapping.roles.indexOf(role);
  const [german, article, turkish, plural] = [column('german'), column('article'), column('turkish'), column('plural')];
  const cell = (row: readonly string[], index: number) => (index >= 0 ? (row[index] ?? '') : '');
  return rows.slice(mapping.hasHeader ? 1 : 0).map((row, index) => {
    const typed = cell(row, article);
    const split = splitArticle(cell(row, german));
    return {
      rowIndex: index + (mapping.hasHeader ? 1 : 0),
      german: typed ? normalizeText(cell(row, german)) : split.lemma,
      article: typed || (split.article ?? ''),
      turkish: normalizeText(cell(row, turkish)),
      plural: normalizeText(cell(row, plural)),
    };
  });
}

/** Separators a person types between a word and its meaning, strongest first. Hyphens need spaces: E-Mail is one word. */
const LINE_SEPARATORS: readonly RegExp[] = [/\t+/u, /\s*=\s*/u, /\s+[–—-]\s+/u, /\s*;\s*/u, /\s*:\s+/u, /\s*,\s*/u];

export function splitLine(line: string): { german: string; turkish: string } {
  const value = normalizeText(line.replace(/\t/g, '\u0001')).replace(/\u0001/g, '\t');
  // Apfel, der, elma: the comma belongs to the article form before it separates the meaning.
  const suffixed = /^(.+?,\s*(?:der|die|das))\s*,\s*(.+)$/iu.exec(value);
  if (suffixed) return { german: suffixed[1]!, turkish: suffixed[2]! };
  for (const separator of LINE_SEPARATORS) {
    const match = separator.exec(value);
    if (match && match.index > 0) return { german: value.slice(0, match.index).trim(), turkish: value.slice(match.index + match[0].length).trim() };
  }
  return { german: value, turkish: '' };
}

/** One entry per line. A line without a meaning stays, so it can be completed in the review. */
export function rowsFromLines(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .forEach((line, rowIndex) => {
      if (!line.trim()) return;
      const { german, turkish } = splitLine(line);
      const split = splitArticle(german);
      rows.push({ rowIndex, german: split.lemma, article: split.article ?? '', turkish, plural: '' });
    });
  return rows;
}

type ParsedInput = { kind: 'lines'; rows: ParsedRow[] } | { kind: 'table'; table: string[][]; mapping: ColumnMapping; confident: boolean };

/**
 * Pasted text is lines unless it is plainly a table of three or more columns, because a comma in a
 * pasted line usually separates meanings. A file is a table whenever one delimiter fits.
 */
export function parseImportText(text: string, origin: 'paste' | 'file'): ParsedInput {
  const delimiter = detectDelimiter(text);
  if (delimiter && (origin === 'file' || delimiter === '\t' || (delimiter !== ',' && parseDelimited(text, delimiter)[0]!.length >= 3))) {
    const table = parseDelimited(text, delimiter);
    return { kind: 'table', table, ...guessColumns(table) };
  }
  return { kind: 'lines', rows: rowsFromLines(text) };
}
