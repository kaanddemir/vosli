import { describe, expect, it } from 'vitest';
import { parseVocabularyPages, repairGlyphs, type PdfPageText, type PdfRow, type PdfTextItem } from '../src/core/pdf/layout';
import { reviewRows, blankDraft, needsAttention } from '../src/core/review';

const item = (text: string, x: number, y: number, extra: Partial<PdfTextItem> = {}): PdfTextItem => ({ text, x, y, width: text.length * 5, height: 10, font: 'f', ...extra });
const centered = (text: string, cx: number, y: number, extra: Partial<PdfTextItem> = {}) => item(text, cx - (text.length * 5) / 2, y, extra);
const COLS = { de: 140, art: 310, tr: 460 };
const header = (y = 700) => [centered('ALMANCA', COLS.de, y), centered('artikel', COLS.art, y), centered('türkçe', COLS.tr, y)];
const row = (de: string, art: string, tr: string, y: number) => [de && centered(de, COLS.de, y), art && centered(art, COLS.art, y), tr && centered(tr, COLS.tr, y)].filter(Boolean) as PdfTextItem[];
const table = (rows: readonly (readonly [string, string, string])[], top = 700, pitch = 17) => rows.flatMap(([de, art, tr], index) => row(de, art, tr, top - pitch * (index + 1)));
const page = (items: PdfTextItem[], number = 1): PdfPageText => ({ page: number, items });
const triple = (rows: readonly PdfRow[]) => rows.map((r) => [r.german, r.article || '-', r.turkish]);
const SAMPLE = [['Apfel', 'der', 'elma'], ['essen', '-', 'yemek'], ['Bär', 'der', 'ayı'], ['Straße', 'die', 'cadde, yol'], ['Haus', 'das', 'ev'], ['Was?', '-', 'Ne?']] as const;

describe('reading a table', () => {
  it('finds rows from a header', () => {
    const result = parseVocabularyPages([page([...header(), ...table(SAMPLE)])]);
    expect(triple(result.rows)).toEqual(SAMPLE);
    expect(result.pages[0]).toMatchObject({ mode: 'header', rows: 6 });
    expect(result.rows[0]).toMatchObject({ page: 1, rowIndex: 1 });
  });

  it('does not depend on stream order', () => {
    const items = [...header(), ...table(SAMPLE)];
    const shuffled = items.map((value, index) => [(index * 7919) % 101, value] as const).sort((a, b) => a[0] - b[0]).map(([, value]) => value);
    expect(triple(parseVocabularyPages([page(shuffled)]).rows)).toEqual(SAMPLE);
  });

  it('survives small vertical and horizontal jitter', () => {
    let seed = 7;
    const shake = () => ((seed = (seed * 16807) % 2147483647) % 1000) / 1000 - 0.5;
    const items = [...header(), ...table(SAMPLE)].map((value) => ({ ...value, y: value.y + shake() * 4, x: value.x + shake() * 20 }));
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual(SAMPLE);
  });

  it('holds at any page scale', () => {
    const items = [...header(), ...table(SAMPLE)].map((value) => ({ ...value, x: value.x * 0.25, y: value.y * 0.25, width: value.width * 0.25, height: value.height * 0.25 }));
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual(SAMPLE);
  });

  it('follows the header when columns come in another order', () => {
    const items = [centered('türkçe', 140, 700), centered('artikel', 310, 700), centered('ALMANCA', 460, 700), ...SAMPLE.flatMap(([de, art, tr], index) => [centered(tr, 140, 683 - index * 17), centered(art, 310, 683 - index * 17), centered(de, 460, 683 - index * 17)])];
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual(SAMPLE);
  });

  it('keeps long left-aligned cells in their own column', () => {
    const long = 'Donaudampfschifffahrtsgesellschaft';
    const items = [item('Almanca', 50, 700), item('Artikel', 300, 700), item('Türkçe', 380, 700), item(long, 50, 683), item('die', 300, 683), item('uzun bir şirket adının Türkçe karşılığı', 380, 683), item('Apfel', 50, 666), item('der', 300, 666), item('elma', 380, 666)];
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual([[long, 'die', 'uzun bir şirket adının Türkçe karşılığı'], ['Apfel', 'der', 'elma']]);
  });

  it('reads a table with two columns, taking the article from the word', () => {
    const items = [centered('Almanca', 140, 700), centered('Türkçe', 460, 700), centered('der Apfel', 140, 683), centered('elma', 460, 683), centered('essen', 140, 666), centered('yemek', 460, 666)];
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual([['Apfel', 'der', 'elma'], ['essen', '-', 'yemek']]);
  });

  it('finds an article column its damaged header does not name, instead of mixing it into the meaning', () => {
    const items = [centered('ALMANCA', COLS.de, 700), centered('art\u0015kel', COLS.art, 700), centered('türkçe', COLS.tr, 700), ...table(SAMPLE)];
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual(SAMPLE);
  });

  it('reads a plural column', () => {
    const items = [centered('Almanca', 100, 700), centered('Artikel', 220, 700), centered('Türkçe', 340, 700), centered('Çoğul', 460, 700), centered('Apfel', 100, 683), centered('der', 220, 683), centered('elma', 340, 683), centered('Äpfel', 460, 683)];
    expect(parseVocabularyPages([page(items)]).rows[0]).toMatchObject({ german: 'Apfel', plural: 'Äpfel' });
  });

  it('reads two tables printed side by side, left one first', () => {
    const heads = [centered('Almanca', 80, 700), centered('Artikel', 170, 700), centered('Türkçe', 240, 700), centered('Almanca', 340, 700), centered('Artikel', 430, 700), centered('Türkçe', 510, 700)];
    const cell = (de: string, a: string, tr: string, base: number, y: number) => [centered(de, base, y), centered(a, base + 90, y), centered(tr, base + 160, y)];
    const items = [...heads, ...cell('Apfel', 'der', 'elma', 80, 683), ...cell('Haus', 'das', 'ev', 340, 683), ...cell('Birne', 'die', 'armut', 80, 666), ...cell('Kind', 'das', 'çocuk', 340, 666)];
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual([['Apfel', 'der', 'elma'], ['Birne', 'die', 'armut'], ['Haus', 'das', 'ev'], ['Kind', 'das', 'çocuk']]);
  });

  it('joins a word cut into runs, and keeps spaces between words', () => {
    const items = [...header(), item('Kranken', 100, 683, { width: 35 }), item('haus', 135, 683, { width: 20 }), centered('das', 310, 683), item('Auf', 440, 683, { width: 15 }), item('Wiedersehen', 458, 683, { width: 55 })];
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual([['Krankenhaus', 'das', 'Auf Wiedersehen']]);
  });

  it('continues over pages that repeat no header', () => {
    const second = page(table([['Haus', 'das', 'ev'], ['essen', '-', 'yemek'], ['Kind', 'das', 'çocuk']], 800), 2);
    const result = parseVocabularyPages([page([...header(), ...table(SAMPLE)]), second]);
    expect(result.pages[1]).toMatchObject({ mode: 'inherited', rows: 3 });
    expect(result.rows.filter((r) => r.page === 2).map((r) => r.german)).toEqual(['Haus', 'essen', 'Kind']);
  });

  it('finds columns without any header from the article column', () => {
    const result = parseVocabularyPages([page(table(SAMPLE))]);
    expect(result.pages[0]!.mode).toBe('inferred');
    expect(triple(result.rows)).toEqual(SAMPLE);
  });

  it('recognizes Turkish on the left when there is no header to say so', () => {
    const items = SAMPLE.flatMap(([de, art, tr], index) => [centered(tr, 140, 683 - index * 17), centered(art, 310, 683 - index * 17), centered(de, 460, 683 - index * 17)]);
    expect(triple(parseVocabularyPages([page(items)]).rows)).toEqual(SAMPLE);
  });

  it('reads a plain list only when nearly every line has that form', () => {
    const list = ['der Apfel - elma', 'essen - yemek', 'die Birne - armut', 'das Haus = ev', 'gut – iyi', 'Lektion'].map((text, index) => item(text, 50, 700 - index * 15));
    const result = parseVocabularyPages([page(list)]);
    expect(result.pages[0]).toMatchObject({ mode: 'lines', rows: 5, ignoredLines: 1 });
    expect(result.rows[0]).toMatchObject({ german: 'Apfel', article: 'der', turkish: 'elma' });
  });
});

describe('text that is not a table', () => {
  it('refuses prose, even with dashes in it', () => {
    const prose = ['Liebe Leute, es freut mich - wirklich!', 'In meiner Freizeit gehe ich oft ins Kino.', 'Das Wetter war heute sehr schön und', 'wir haben uns wirklich gut amüsiert.', 'Ich mag es, neue Filme anzuschauen.', 'Bis bald - euer Max', 'Das ist alles.'].map((text, index) => item(text, 50, 700 - index * 15));
    expect(parseVocabularyPages([page(prose)]).pages[0]).toMatchObject({ mode: 'no_table', rows: 0 });
  });

  it('does not read a bulleted names page as a continued table', () => {
    const names = ['Adolf', 'Bruno', 'Clara', 'Dora', 'Emil', 'Frieda'].flatMap((name, index) => [item('•', 79, 600 - index * 12), item(name, 91, 600 - index * 12), item('•', 400, 600 - index * 12), item(`${name}a`, 412, 600 - index * 12)]);
    const result = parseVocabularyPages([page([...header(), ...table(SAMPLE)]), page(names, 2)]);
    expect(result.pages[1]).toMatchObject({ mode: 'no_table', rows: 0 });
    expect(result.rows).toHaveLength(6);
  });

  it('reports a page without text', () => {
    expect(parseVocabularyPages([page([])]).pages[0]).toMatchObject({ mode: 'no_text' });
  });

  it('leaves page numbers and footers out, and says so', () => {
    const result = parseVocabularyPages([page([...header(), ...table(SAMPLE), centered('3', COLS.art, 40), centered('www.example.com', COLS.de, 25)])]);
    expect(result.rows).toHaveLength(6);
    expect(result.pages[0]!.ignoredLines).toBe(2);
  });
});

describe('uncertain rows stay visible', () => {
  it('merges a wrapped meaning and marks it', () => {
    const rows = parseVocabularyPages([page([...header(), ...row('Apfel', 'der', 'elma', 683), centered('(meyve)', COLS.tr, 672), ...row('Haus', 'das', 'ev', 649), ...row('Kind', 'das', 'çocuk', 632)])]).rows;
    expect(rows[0]).toMatchObject({ turkish: 'elma (meyve)', flags: ['wrapped'] });
    expect(rows).toHaveLength(3);
  });

  it('merges a wrapped word', () => {
    const rows = parseVocabularyPages([page([...header(), ...row('Donaudampf', 'die', 'şirket', 683), centered('schifffahrt', COLS.de, 672), ...row('Haus', 'das', 'ev', 649), ...row('Kind', 'das', 'çocuk', 632)])]).rows;
    // A cut with no hyphen could be two words, so a person is asked.
    expect(rows[0]).toMatchObject({ german: 'Donaudampf schifffahrt', flags: ['wrapped', 'wrapped_word'] });
  });

  const wrappedGerman = (first: string, second: string) => parseVocabularyPages([page([...header(), ...row(first, 'das', 'şirket', 683), centered(second, COLS.de, 672), ...row('Haus', 'das', 'ev', 649), ...row('Kind', 'das', 'çocuk', 632)])]).rows[0]!;

  it('removes a hyphen that only marked the line end', () => {
    expect(wrappedGerman('Kranken-', 'haus')).toMatchObject({ german: 'Krankenhaus', flags: ['wrapped', 'dehyphenated'] });
  });

  it('keeps a hyphen that belongs to the text', () => {
    expect(wrappedGerman('Baden-', 'Württemberg').german).toBe('Baden- Württemberg');
    expect(wrappedGerman('Vor-', 'und Nachname').german).toBe('Vor- und Nachname');
  });

  it('removes a line-end hyphen in a meaning too', () => {
    const rows = parseVocabularyPages([page([...header(), ...row('Apfel', 'der', 'meyve-', 683), centered('lerin kralı', COLS.tr, 672), ...row('Haus', 'das', 'ev', 649), ...row('Kind', 'das', 'çocuk', 632)])]).rows;
    expect(rows[0]).toMatchObject({ turkish: 'meyvelerin kralı', flags: ['wrapped', 'dehyphenated'] });
  });

  it('does not ask about a wrapped phrase of capitalized words', () => {
    expect(wrappedGerman('Auf', 'Wiedersehen').flags).toEqual(['wrapped']);
  });

  it('merges a centered row whose first wrapped line is printed above the word', () => {
    const rows = parseVocabularyPages([page([...header(), ...row('Apfel', 'der', 'elma', 683), centered('ilk satır', COLS.tr, 660), ...row('Haus', 'das', '', 654), centered('ikinci satır', COLS.tr, 648), ...row('Kind', 'das', 'çocuk', 632)])]).rows;
    expect(rows.map((r) => r.german)).toEqual(['Apfel', 'Haus', 'Kind']);
    expect(rows[1]).toMatchObject({ turkish: 'ilk satır ikinci satır', flags: ['wrapped'] });
  });

  it('keeps a row with a missing meaning, which the review then refuses', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['Apfel', 'der', 'elma'], ['Birne', 'die', ''], ['Haus', 'das', 'ev']])])]).rows;
    expect(rows.map((r) => r.turkish)).toEqual(['elma', '', 'ev']);
    const [, birne] = reviewRows(rows.map((r, index) => blankDraft(String(index), r.rowIndex, { german: r.german, article: r.article, turkish: r.turkish })), []);
    expect(birne!.status).toMatchObject({ kind: 'invalid', errors: ['turkish_missing'] });
  });

  it('keeps a row with a missing word', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['Apfel', 'der', 'elma'], ['', 'die', 'armut'], ['Haus', 'das', 'ev']])])]).rows;
    expect(rows[1]).toMatchObject({ german: '', article: 'die', turkish: 'armut' });
  });

  it('warns when an article cell is empty in a table that writes dashes', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['Apfel', 'der', 'elma'], ['essen', '-', 'yemek'], ['Birne', '', 'armut']])])]).rows;
    expect(rows[2]).toMatchObject({ article: '', flags: ['article_missing'] });
    expect(rows[1]!.flags).toEqual([]);
  });

  it('warns about an empty article cell in a table of nouns only', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['Apfel', 'der', 'elma'], ['Haus', 'das', 'ev'], ['Birne', '', 'armut']])])]).rows;
    expect(rows[2]!.flags).toEqual(['article_missing']);
  });

  it('warns about an article before a lowercase word, without changing either', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['apfel', 'der', 'elma']])])]).rows;
    expect(rows[0]).toMatchObject({ german: 'apfel', article: 'der', flags: ['article_lowercase'] });
  });

  it('never corrects a suspicious article from the source', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['Geldautomat', 'das', 'ATM'], ['Moos', 'der', 'yosun'], ['Chor', 'das', 'koro']])])]).rows;
    expect(triple(rows)).toEqual([['Geldautomat', 'das', 'ATM'], ['Moos', 'der', 'yosun'], ['Chor', 'das', 'koro']]);
    expect(rows.every((r) => r.flags.length === 0)).toBe(true);
  });

  it('passes on an article cell it does not know, for the review to refuse', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['Apfel', 'dem', 'elma']])])]).rows;
    expect(needsAttention(reviewRows([blankDraft('1', 1, { german: rows[0]!.german, article: rows[0]!.article, turkish: rows[0]!.turkish })], [])[0]!.status)).toBe(true);
  });
});

describe('repairing the Turkish i', () => {
  const words = (ctrl: string) => [`L${ctrl}ebe`, 'kadın', 'aşk', `Z${ctrl}el`, 'açık', `v${ctrl}el`, 'kısa'].map((text, index) => item(text, 50, 700 - index * 12));

  it('repairs the one unmapped character, whichever code it has', () => {
    for (const ctrl of ['\u001e', '\u001f', '\u001c']) {
      const { pages, repairs } = repairGlyphs([page(words(ctrl))]);
      expect(pages[0]!.items[0]!.text).toBe('Liebe');
      expect(repairs).toEqual([{ font: 'f', code: ctrl.codePointAt(0), count: 3 }]);
    }
  });

  it('leaves a font with two unmapped characters alone', () => {
    const { pages, repairs } = repairGlyphs([page([...words('\u001e'), item('\u0015a', 50, 500)])]);
    expect(repairs).toEqual([]);
    expect(pages[0]!.items[0]!.text).toBe('L\u001eebe');
  });

  it('leaves a font that also has a real i alone', () => {
    const { pages, repairs } = repairGlyphs([page([...words('\u001e'), item('ich', 50, 500)])]);
    expect(repairs).toEqual([]);
    expect(pages[0]!.items[0]!.text).toBe('L\u001eebe');
  });

  it('leaves a font without Turkish letters alone: it is not this problem', () => {
    const { repairs } = repairGlyphs([page([item('Haus\u001e', 50, 700), item('Apfel', 50, 680)])]);
    expect(repairs).toEqual([]);
  });

  it('judges each font on its own', () => {
    const { pages } = repairGlyphs([page([...words('\u001e'), item('Ka\u0015um', 50, 500, { font: 'other' })])]);
    expect(pages[0]!.items[0]!.text).toBe('Liebe');
    expect(pages[0]!.items.at(-1)!.text).toBe('Ka\u0015um');
  });

  it('leaves what cannot be repaired for the review to refuse', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['L\u001ebe\u0015', 'die', 'aşk']])])]).rows;
    const [reviewed] = reviewRows([blankDraft('1', 1, { german: rows[0]!.german, article: rows[0]!.article, turkish: rows[0]!.turkish })], []);
    expect(reviewed!.status).toMatchObject({ kind: 'invalid', errors: ['unreadable'] });
  });

  it('keeps German and Turkish letters, and composes decomposed ones', () => {
    const letters = 'ÄÖÜäöüß şŞğĞıİçÇ';
    const rows = parseVocabularyPages([page([...header(), ...table([['Müller', 'der', letters]])])]).rows;
    expect(rows[0]).toMatchObject({ german: 'Müller', turkish: letters });
  });

  it('removes invisible soft hyphens', () => {
    const rows = parseVocabularyPages([page([...header(), ...table([['Kran­ken', '-', 'hasta']])])]).rows;
    expect(rows[0]!.german).toBe('Kranken');
  });
});

describe('sections', () => {
  it('takes the heading right above the table, collapsing letter spacing', () => {
    const heading = [item('T E L A F F U Z', 42, 730), item('- D I E', 127, 730), item('A U S S P R A C H E', 170, 730)];
    const result = parseVocabularyPages([page([item('www.example.com', 42, 790), ...heading, ...header(), ...table(SAMPLE)])]);
    expect(result.sections).toEqual(['TELAFFUZ - DIE AUSSPRACHE']);
    expect(result.rows[0]!.section).toBe('TELAFFUZ - DIE AUSSPRACHE');
  });

  it('attaches a stray letter to the word before it', () => {
    const heading = [item('V E D A L A Ş M A', 42, 730), item('K .', 150, 730), item('- D I E', 180, 730), item('G R U ß', 220, 730)];
    expect(parseVocabularyPages([page([...heading, ...header(), ...table(SAMPLE)])]).sections).toEqual(['VEDALAŞMAK. - DIE GRUß']);
  });

  it('invents nothing when no heading stands near the table', () => {
    const result = parseVocabularyPages([page([item('Bir başlık', 42, 800), ...header(500), ...table(SAMPLE, 500)])]);
    expect(result.sections).toEqual([]);
    expect(result.rows[0]!.section).toBe('');
  });

  it('counts one heading repeated on every page once', () => {
    const one = (n: number) => page([item('Lektion 1', 42, 730), ...header(), ...table(SAMPLE)], n);
    expect(parseVocabularyPages([one(1), one(2)]).sections).toEqual(['Lektion 1']);
  });

  it('gives each table under its own heading its own section, also on one page', () => {
    const first = table(SAMPLE.slice(0, 2));
    const secondTop = 620;
    const result = parseVocabularyPages([page([item('Lektion 1', 42, 730), ...header(), ...first, item('Lektion 2', 42, secondTop + 30), ...header(secondTop), ...table(SAMPLE.slice(2, 4), secondTop)])]);
    expect(result.sections).toEqual(['Lektion 1', 'Lektion 2']);
    expect(result.rows.map((r) => r.section)).toEqual(['Lektion 1', 'Lektion 1', 'Lektion 2', 'Lektion 2']);
    expect(result.rows.map((r) => r.german)).toEqual(['Apfel', 'essen', 'Bär', 'Straße']);
  });

  it('keeps a section for the following page when only the first has the heading', () => {
    const result = parseVocabularyPages([page([item('Lektion 1', 42, 730), ...header(), ...table(SAMPLE)]), page(table(SAMPLE, 800), 2)]);
    expect(result.rows.at(-1)).toMatchObject({ page: 2, section: 'Lektion 1' });
  });
});
