import { normalizeText } from '../identity';
import { hasUnreadableText, splitArticle } from '../vocabulary';

/** One run of text on a page, measured with y growing upward. */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
}

export interface PdfPageText {
  page: number;
  items: PdfTextItem[];
}

export interface PdfRow {
  page: number;
  /** Position among the rows of its page, from 1. */
  rowIndex: number;
  german: string;
  article: string;
  turkish: string;
  plural: string;
  flags: string[];
  /** Heading printed above the table, or empty. */
  section: string;
}

/** How a page was read. "inferred" and "lines" were not confirmed by a printed table header. */
type PageMode = 'header' | 'inherited' | 'inferred' | 'lines' | 'no_table' | 'no_text';

interface PdfPageReport {
  page: number;
  mode: PageMode;
  rows: number;
  /** Lines around a table that were left out, such as page numbers. */
  ignoredLines: number;
}

interface GlyphRepair {
  font: string;
  code: number;
  count: number;
}

export interface PdfParseResult {
  rows: PdfRow[];
  pages: PdfPageReport[];
  repairs: GlyphRepair[];
  /** Headings in the order they appear. */
  sections: string[];
}

const CONTROL = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/u;
const INVISIBLE = /[­​-‍⁠﻿]/gu;
const LETTER = /\p{L}/gu;

/**
 * The course PDFs draw the letter i with a Turkish glyph that has no Unicode value, so PDF.js
 * reports it as one control character, a different one per file. It is only repaired when a font
 * has exactly one such character, never a real i but a Turkish ı, and uses it as often as a
 * language uses i. Anything else stays as it is and the review refuses it, because guessing would
 * change words.
 */
export function repairGlyphs(pages: readonly PdfPageText[]): { pages: PdfPageText[]; repairs: GlyphRepair[] } {
  const fonts = new Map<string, { controls: Map<string, number>; realI: number; dotless: number; letters: number }>();
  for (const { items } of pages) {
    for (const { text, font } of items) {
      let entry = fonts.get(font);
      if (!entry) fonts.set(font, (entry = { controls: new Map(), realI: 0, dotless: 0, letters: 0 }));
      for (const char of text) {
        if (CONTROL.test(char)) entry.controls.set(char, (entry.controls.get(char) ?? 0) + 1);
        if (char === 'i') entry.realI++;
        if (char === 'ı') entry.dotless++;
      }
      entry.letters += text.match(LETTER)?.length ?? 0;
    }
  }

  const fixes = new Map<string, string>();
  const repairs: GlyphRepair[] = [];
  for (const [font, entry] of fonts) {
    if (entry.controls.size !== 1 || entry.realI > 0 || entry.dotless === 0) continue;
    const [char, count] = [...entry.controls][0]!;
    if (count / (entry.letters + count) < 0.02) continue;
    fixes.set(font, char);
    repairs.push({ font, code: char.codePointAt(0)!, count });
  }

  const clean = (item: PdfTextItem) => {
    const broken = fixes.get(item.font);
    const text = broken ? item.text.split(broken).join('i') : item.text;
    return { ...item, text: text.replace(INVISIBLE, '').normalize('NFC') };
  };
  return { pages: pages.map((page) => ({ page: page.page, items: page.items.map(clean) })), repairs };
}

type ColumnKind = 'german' | 'article' | 'turkish' | 'plural';

interface Column {
  kind: ColumnKind;
  center: number;
}

const HEADER_WORDS: Readonly<Record<ColumnKind, readonly string[]>> = {
  german: ['almanca', 'deutsch', 'german', 'kelime', 'wort', 'sozcuk'],
  article: ['artikel', 'article'],
  turkish: ['turkce', 'turkisch', 'turkish', 'anlam', 'anlami', 'anlamlari'],
  plural: ['cogul', 'plural', 'mehrzahl'],
};

const foldHeader = (text: string) => text.toLocaleLowerCase('tr').replace(/\s/g, '').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/[:.]$/, '');

function headerKind(text: string): ColumnKind | null {
  const folded = foldHeader(text);
  for (const kind of Object.keys(HEADER_WORDS) as ColumnKind[]) if (HEADER_WORDS[kind].includes(folded)) return kind;
  return null;
}

const median = (values: readonly number[], fallback: number) => {
  if (values.length === 0) return fallback;
  return [...values].sort((a, b) => a - b)[values.length >> 1]!;
};

interface Line {
  y: number;
  items: PdfTextItem[];
}

const centerOf = (item: PdfTextItem) => item.x + item.width / 2;

/** Stream order means nothing in these files, so lines come from positions alone. */
function linesOf(items: readonly PdfTextItem[], height: number): Line[] {
  const lines: Line[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - item.y) <= height * 0.5) last.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines;
}

/** Runs inside one cell: a gap narrower than a space means one word was cut in two. */
function joinCell(items: readonly PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = '';
  let end = 0;
  for (const item of sorted) {
    const part = item.text.trim();
    if (!part) continue;
    const touching = text !== '' && item.x - end < item.height * 0.12;
    text += text === '' || touching ? part : ` ${part}`;
    end = item.x + item.width;
  }
  return normalizeText(text);
}

/** The columns of each table on a header line. Side-by-side tables repeat the same headers. */
function tablesInHeader(line: Line): Column[][] {
  const tables: Column[][] = [];
  let current: Column[] = [];
  for (const item of [...line.items].sort((a, b) => a.x - b.x)) {
    const kind = headerKind(item.text);
    if (!kind) continue;
    if (current.some((column) => column.kind === kind)) {
      tables.push(current);
      current = [];
    }
    current.push({ kind, center: centerOf(item) });
  }
  tables.push(current);
  return tables.filter((table) => table.some((c) => c.kind === 'german') && table.some((c) => c.kind === 'turkish'));
}

/**
 * Where one column ends and the next begins: the widest empty stretch between their centers.
 * This suits centered and left-aligned tables alike. With no empty stretch, the middle.
 */
function boundaries(columns: readonly Column[], items: readonly PdfTextItem[]): number[] {
  const result: number[] = [];
  const spans = items.map((item) => [item.x, item.x + item.width] as const).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i + 1 < columns.length; i++) {
    const left = columns[i]!.center;
    const right = columns[i + 1]!.center;
    let reach = left;
    let best = 0;
    let at = (left + right) / 2;
    for (const [start, end] of spans) {
      if (end <= left) continue;
      if (start >= right) break;
      if (start - reach > best) {
        best = start - reach;
        at = (start + reach) / 2;
      }
      reach = Math.max(reach, end);
    }
    if (right - reach > best) at = (right + reach) / 2;
    result.push(at);
  }
  return result;
}

const columnIndex = (limits: readonly number[], x: number) => {
  let index = 0;
  while (index < limits.length && x >= limits[index]!) index++;
  return index;
};

interface Cells {
  y: number;
  german: string;
  article: string;
  turkish: string;
  plural: string;
  flags: string[];
}

const DASH = /^[-–—]$/u;
const NOISE = /^(\d{1,4}|(sayfa|seite|page)\s*\d+|\d+\s*\/\s*\d+|\S*(www\.|https?:|\.com|\.de|@)\S*)$/iu;
const FILLED: readonly ColumnKind[] = ['german', 'turkish', 'plural'];
const LINE_END_HYPHEN = /\p{L}-$/u;
const STARTS_LOWERCASE = /^\p{Ll}/u;
/** Vor- und Nachname: this hyphen belongs to the text. */
const KEEPS_HYPHEN = /^(und|oder|bzw\.?|ve|veya|ya da)\b/iu;

/**
 * Continues a wrapped cell. Kranken- then haus is one word: the hyphen only marked the line end.
 * A word cut with no hyphen at all cannot be told from two words, so it is marked for a person.
 */
function continueCell(row: Cells, kind: ColumnKind, text: string): void {
  const before = row[kind];
  const mark = (flag: string) => {
    if (!row.flags.includes(flag)) row.flags.push(flag);
  };
  mark('wrapped');
  if (before && LINE_END_HYPHEN.test(before) && STARTS_LOWERCASE.test(text) && !KEEPS_HYPHEN.test(text)) {
    row[kind] = before.slice(0, -1) + text;
    mark('dehyphenated');
    return;
  }
  if (before && kind === 'german' && STARTS_LOWERCASE.test(text)) mark('wrapped_word');
  row[kind] = before ? `${before} ${text}` : text;
}

/**
 * Rebuilds rows from lines. A line holding text in one column only continues a wrapped cell, and
 * is marked so a person checks it. Lines that cannot be placed stay in as incomplete rows and the
 * review refuses them, except text standing clear above or below the table, such as page numbers.
 */
function rowsOfLines(lines: readonly Line[], columns: readonly Column[], limits: readonly number[], height: number): { rows: Cells[]; ignored: number } {
  const cells: Cells[] = lines.map((line) => {
    const parts = new Map<ColumnKind, PdfTextItem[]>();
    for (const item of line.items) {
      const kind = columns[columnIndex(limits, centerOf(item))]!.kind;
      parts.set(kind, [...(parts.get(kind) ?? []), item]);
    }
    const text = (kind: ColumnKind) => joinCell(parts.get(kind) ?? []);
    return { y: line.y, german: text('german'), article: text('article'), turkish: text('turkish'), plural: text('plural'), flags: [] };
  });

  const gaps: number[] = [];
  cells.forEach((cell, index) => {
    const next = cells[index + 1];
    if (next && cell.german && cell.turkish && next.german && next.turkish) gaps.push(cell.y - next.y);
  });
  const pitch = median(gaps, height * 1.6);
  const closeEnough = (gap: number) => gap < Math.min(height * 1.5, pitch * 0.95);
  const loneColumn = (cell: Cells) => {
    const filled = FILLED.filter((kind) => cell[kind]);
    return !cell.article && filled.length === 1 ? filled[0]! : null;
  };

  let start = 0;
  let end = cells.length;
  const complete = (cell: Cells) => Boolean(cell.german && cell.turkish);
  const firstComplete = cells.findIndex(complete);
  const lastComplete = cells.findLastIndex(complete);
  const standsClear = (cell: Cells, gap: number) => {
    const text = [cell.german, cell.article, cell.turkish, cell.plural].filter(Boolean);
    return text.length === 1 && (gap > pitch * 1.6 || NOISE.test(text[0]!));
  };
  if (firstComplete >= 0) {
    while (start < firstComplete && standsClear(cells[start]!, cells[start]!.y - cells[start + 1]!.y)) start++;
    while (end - 1 > lastComplete && standsClear(cells[end - 1]!, cells[end - 2]!.y - cells[end - 1]!.y)) end--;
  }
  const ignored = start + (cells.length - end);

  const rows: Cells[] = [];
  for (let i = start; i < end; i++) {
    const cell = cells[i]!;
    const lone = loneColumn(cell);
    const previous = rows.at(-1);
    const next = i + 1 < end ? cells[i + 1] : undefined;
    if (lone) {
      const gapBefore = previous ? previous.y - cell.y : Infinity;
      const gapAfter = next ? cell.y - next.y : Infinity;
      // A centered row prints its first wrapped line above the others.
      if (next && !next[lone] && closeEnough(gapAfter) && gapAfter < gapBefore && (next.german || next.turkish)) {
        continueCell(next, lone, cell[lone]);
        continue;
      }
      if (previous && closeEnough(gapBefore)) {
        continueCell(previous, lone, cell[lone]);
        previous.y = cell.y;
        continue;
      }
    }
    rows.push(cell);
  }
  return { rows, ignored };
}

/** A table without its own header, recognized by a column holding almost nothing but articles. */
function inferColumns(items: readonly PdfTextItem[], height: number): { columns: Column[]; top: number } | null {
  const articles = items.filter((item) => /^(der|die|das|-|–|—)$/iu.test(item.text.trim()));
  if (articles.length < 5) return null;
  const middle = median(articles.map(centerOf), 0);
  const inColumn = articles.filter((item) => Math.abs(centerOf(item) - middle) < height * 2);
  if (inColumn.length / articles.length < 0.9) return null;
  const top = Math.max(...inColumn.map((item) => item.y)) + height * 0.5;
  const others = items.filter((item) => item.y <= top && Math.abs(centerOf(item) - middle) > height * 2);
  const left = others.filter((item) => centerOf(item) < middle);
  const right = others.filter((item) => centerOf(item) > middle);
  if (left.length === 0 || right.length === 0) return null;
  // Only letters that exist in one language can tell the columns apart.
  const count = (side: readonly PdfTextItem[], letters: RegExp) => side.reduce((sum, item) => sum + (item.text.match(letters)?.length ?? 0), 0);
  const turkish = /[şğıİ]/gu;
  const german = /[äß]/gu;
  const swapped = count(left, turkish) > count(right, turkish) && count(right, german) >= count(left, german);
  const leftCenter = median(left.map(centerOf), 0);
  const rightCenter = median(right.map(centerOf), 0);
  return {
    columns: [
      { kind: swapped ? 'turkish' : 'german', center: leftCenter },
      { kind: 'article', center: middle },
      { kind: swapped ? 'german' : 'turkish', center: rightCenter },
    ],
    top,
  };
}

/** Letter-spaced headings arrive as S E L A M L A Ş M A, with a stray K . now and then. */
function collapseSpacedLetters(run: string): string {
  return run
    .trim()
    .split(/\s{2,}/u)
    .map((part) => {
      const tokens = part.split(' ');
      const single = tokens.filter((token) => [...token].length === 1).length;
      if (tokens.length < 2 || single / tokens.length < 0.7) return part;
      const dash = DASH.test(tokens[0]!) ? `${tokens.shift()} ` : '';
      return dash + tokens.join('');
    })
    .join(' ');
}

function headingOf(line: Line | undefined): string {
  if (!line) return '';
  const parts = [...line.items].sort((a, b) => a.x - b.x).map((item) => collapseSpacedLetters(item.text)).filter(Boolean);
  const joined: string[] = [];
  for (const part of parts) {
    const letters = part.match(LETTER)?.length ?? 0;
    if (letters === 1 && joined.length && !DASH.test(part[0]!)) joined[joined.length - 1] += part;
    else joined.push(part);
  }
  const heading = normalizeText(joined.join(' '));
  if (!/\p{L}{2}/u.test(heading) || hasUnreadableText(heading) || NOISE.test(heading)) return '';
  return heading;
}

const SEPARATED = /^(.+?)\s+[-–—=]\s+(.+)$/u;

/** A plain list such as Apfel - elma: only when nearly every line has that form, so prose never qualifies. */
function rowsOfPlainLines(lines: readonly Line[]): { rows: Cells[]; ignored: number } | null {
  const texts = lines.map((line) => ({ y: line.y, text: joinCell(line.items).replace(/^[•·▪◦*]\s*/u, '') }));
  const pairs = texts.map(({ y, text }) => ({ y, match: SEPARATED.exec(text) })).filter((entry) => entry.match);
  if (pairs.length < 5 || pairs.length / lines.length < 0.7) return null;
  const rows = pairs.map(({ y, match }) => {
    const { article, lemma } = splitArticle(match![1]!);
    return { y, german: lemma, article: article ?? '', turkish: normalizeText(match![2]!), plural: '', flags: [] };
  });
  return { rows, ignored: lines.length - pairs.length };
}

/** Moves an article out of the word column, and marks cells that look wrong without changing them. */
function finishRow(cell: Cells, hasArticleColumn: boolean, emptyIsSuspicious: boolean): Cells {
  const flags = [...cell.flags];
  let { german, article } = cell;
  if (DASH.test(article)) article = '';
  else if (!article && german) {
    const split = splitArticle(german);
    if (split.article) {
      german = split.lemma;
      article = split.article;
    } else if (hasArticleColumn && emptyIsSuspicious && cell.turkish) flags.push('article_missing');
  }
  if (article && /^\p{Ll}/u.test(german)) flags.push('article_lowercase');
  return { ...cell, german, article, flags };
}

/**
 * Turns page text into candidate rows. Nothing here reads a file or a database, so any source of
 * positioned text can use it. No row is dropped or corrected on a guess: what is uncertain carries
 * a flag or fails validation, and a person decides in the review.
 */
export function parseVocabularyPages(input: readonly PdfPageText[]): PdfParseResult {
  const { pages, repairs } = repairGlyphs(input);
  const rows: PdfRow[] = [];
  const reports: PdfPageReport[] = [];
  const sections: string[] = [];
  let lastColumns: Column[][] | null = null;
  let section = '';

  const output = (pageNumber: number, cells: readonly Cells[], hasArticleColumn: boolean, startIndex: number) => {
    // A table that writes a dash for "none", or fills most of the column, means an empty cell lost something.
    const filled = cells.filter((cell) => cell.article).length;
    const emptyIsSuspicious = cells.some((cell) => DASH.test(cell.article)) || filled / cells.length >= 0.5;
    cells.forEach((cell, index) => {
      const { german, article, turkish, plural, flags } = finishRow(cell, hasArticleColumn, emptyIsSuspicious);
      rows.push({ page: pageNumber, rowIndex: startIndex + index + 1, german, article, turkish, plural, flags, section });
    });
  };
  const setSection = (heading: string) => {
    if (!heading) return;
    section = heading;
    if (!sections.includes(heading)) sections.push(heading);
  };

  for (const { page, items: all } of pages) {
    const items = all.filter((item) => item.text.trim());
    if (items.length === 0) {
      reports.push({ page, mode: 'no_text', rows: 0, ignoredLines: 0 });
      continue;
    }
    const height = median(items.map((item) => item.height), 10);
    const lines = linesOf(items, height);
    let count = 0;
    let ignored = 0;

    const readTables = (body: readonly Line[], tables: readonly Column[][]) => {
      const bodyItems = body.flatMap((line) => line.items);
      const starts = tables.map((table) => Math.min(...table.map((column) => column.center)));
      // Between side-by-side tables, the same search finds the gutter.
      const dividers = boundaries(tables.map((table, index) => ({ kind: 'german' as const, center: index === 0 ? table.at(-1)!.center : starts[index]! })), bodyItems);
      tables.forEach((table, index) => {
        const low = index === 0 ? -Infinity : dividers[index - 1]!;
        const high = index === tables.length - 1 ? Infinity : dividers[index]!;
        const inTable = (item: PdfTextItem) => centerOf(item) >= low && centerOf(item) < high;
        const scoped = body.map((line) => ({ y: line.y, items: line.items.filter(inTable) })).filter((line) => line.items.length > 0);
        const ordered = [...table].sort((a, b) => a.center - b.center);
        const limits = boundaries(ordered, scoped.flatMap((line) => line.items));
        const read = rowsOfLines(scoped, ordered, limits, height);
        output(page, read.rows, ordered.some((column) => column.kind === 'article'), count);
        count += read.rows.length;
        ignored += read.ignored;
      });
    };

    const headerAt = lines.flatMap((line, index) => {
      const tables = tablesInHeader(line);
      return tables.length ? [{ index, tables }] : [];
    });

    if (headerAt.length > 0) {
      headerAt.forEach(({ index, tables }, position) => {
        const nextHeader = headerAt[position + 1]?.index ?? lines.length;
        const before = lines[index - 1];
        const usable = before && before.y - lines[index]!.y <= height * 6;
        setSection(headingOf(usable ? before : undefined));
        // A heading of the next table is not part of this one.
        const nextHeading = position + 1 < headerAt.length && nextHeader - 1 > index && headingOf(lines[nextHeader - 1]) ? nextHeader - 1 : nextHeader;
        const body = lines.slice(index + 1, nextHeading);
        // A damaged header can miss a column that is plainly there; der would then end up in the meaning.
        const seen = tables.length === 1 && !tables[0]!.some((column) => column.kind === 'article') ? inferColumns(body.flatMap((line) => line.items), height) : null;
        const complete = seen ? [[...tables[0]!, seen.columns.find((column) => column.kind === 'article')!]] : tables;
        readTables(body, complete);
        lastColumns = complete;
      });
      reports.push({ page, mode: 'header', rows: count, ignoredLines: ignored });
      continue;
    }

    // A long table may print its header on the first page only.
    if (lastColumns) {
      const previous: Column[][] = lastColumns;
      const before = rows.length;
      const startCount = count;
      readTables(lines, previous);
      const added = rows.slice(before);
      // Two lists side by side could fill any two columns, so an article column must be filled as well.
      const whole = added.filter((row) => row.german && row.turkish).length;
      const needsArticles = previous.some((table) => table.some((column) => column.kind === 'article'));
      const dashes = items.filter((item) => DASH.test(item.text.trim())).length;
      const articles = added.filter((row) => row.article).length + dashes;
      const bulleted = items.filter((item) => /^[•·▪◦]/u.test(item.text.trim())).length > added.length / 2;
      if (added.length > 0 && !bulleted && whole / added.length >= 0.6 && (!needsArticles || articles / added.length >= 0.6)) {
        reports.push({ page, mode: 'inherited', rows: count, ignoredLines: ignored });
        continue;
      }
      rows.length = before;
      count = startCount;
      ignored = 0;
    }

    const inferred = inferColumns(items, height);
    if (inferred) {
      const body = lines.filter((line) => line.y <= inferred.top);
      const limits = boundaries([...inferred.columns].sort((a, b) => a.center - b.center), body.flatMap((line) => line.items));
      const read = rowsOfLines(body, [...inferred.columns].sort((a, b) => a.center - b.center), limits, height);
      output(page, read.rows, true, 0);
      lastColumns = [inferred.columns];
      reports.push({ page, mode: 'inferred', rows: read.rows.length, ignoredLines: read.ignored + lines.length - body.length });
      continue;
    }

    const plain = rowsOfPlainLines(lines);
    if (plain) {
      output(page, plain.rows, false, 0);
      reports.push({ page, mode: 'lines', rows: plain.rows.length, ignoredLines: plain.ignored });
      continue;
    }

    reports.push({ page, mode: 'no_table', rows: 0, ignoredLines: lines.length });
  }

  return { rows, pages: reports, repairs, sections };
}
