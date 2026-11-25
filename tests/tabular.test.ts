import { describe, expect, it } from 'vitest';
import { assignRole, columnRolesFor, decodeBytes, detectDelimiter, guessColumns, mappingIsComplete, parseDelimited, parseImportText, rowsFromLines, rowsFromTable, splitLine } from '../src/core/tabular';

describe('decoding files', () => {
  const text = 'Fuß;ıspanak;çiçek;Größe';
  it('reads UTF-8, with or without a byte order mark', () => {
    expect(decodeBytes(new TextEncoder().encode(text))).toBe(text);
    expect(parseDelimited(decodeBytes(new TextEncoder().encode(`﻿${text}`)), ';')[0]![0]).toBe('Fuß');
  });

  it('reads UTF-16 from Excel', () => {
    const units = [0xfeff, ...Array.from(text, (char) => char.charCodeAt(0))];
    expect(decodeBytes(new Uint8Array(new Uint16Array(units).buffer))).toContain('ıspanak');
  });

  it('falls back to the Turkish Windows code page instead of showing junk', () => {
    expect(decodeBytes(new Uint8Array([0x46, 0x75, 0xdf, 0x3b, 0xfd, 0xfe]))).toBe('Fuß;ış');
  });
});

describe('delimited text', () => {
  it('reads quoted delimiters, doubled quotes and line breaks in quotes', () => {
    expect(parseDelimited('"Apfel, der","elma, ""kırmızı"""\n"a\nb",c', ',')).toEqual([
      ['Apfel, der', 'elma, "kırmızı"'],
      ['a\nb', 'c'],
    ]);
  });

  it('handles every line ending and ignores blank lines', () => {
    expect(parseDelimited('a;b\r\nc;d\re;f\n\n;\n', ';')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
  });

  it('keeps an empty cell in its column', () => {
    expect(parseDelimited('Apfel;;elma', ';')).toEqual([['Apfel', '', 'elma']]);
  });

  it('detects the common delimiters', () => {
    expect(detectDelimiter('a,b\nc,d')).toBe(',');
    expect(detectDelimiter('a;b\nc;d')).toBe(';');
    expect(detectDelimiter('a\tb\nc\td')).toBe('\t');
    expect(detectDelimiter('a|b\nc|d')).toBe('|');
    expect(detectDelimiter('just\nwords')).toBeNull();
  });

  it('prefers a semicolon when commas sit inside meanings', () => {
    expect(detectDelimiter('Apfel;elma, alma\nBirne;armut, ayva')).toBe(';');
  });
});

describe('column mapping', () => {
  it('recognizes headers, in Turkish without its special letters too', () => {
    const { mapping, confident } = guessColumns([['Türkçe', 'Artikel', 'Almanca', 'Çoğul', 'Not'], ['elma', 'der', 'Apfel', 'Äpfel', '']]);
    expect(confident).toBe(true);
    expect(mapping).toEqual({ hasHeader: true, roles: ['turkish', 'article', 'german', 'plural', 'ignore'] });
  });

  it('assumes German then Turkish for two unnamed columns', () => {
    expect(guessColumns([['Apfel', 'elma']])).toEqual({ mapping: { hasHeader: false, roles: ['german', 'turkish'] }, confident: true });
  });

  it('finds an unnamed article column by its contents', () => {
    expect(guessColumns([['der', 'Apfel', 'elma'], ['', 'essen', 'yemek']])).toEqual({ mapping: { hasHeader: false, roles: ['article', 'german', 'turkish'] }, confident: true });
  });

  it('takes English or İngilizce as the word column of an English file, and nothing German', () => {
    expect(guessColumns([['English', 'Türkçe'], ['apple', 'elma']], 'en').mapping).toEqual({ hasHeader: true, roles: ['german', 'turkish'] });
    expect(guessColumns([['İngilizce', 'Anlam'], ['apple', 'elma']], 'en').mapping).toEqual({ hasHeader: true, roles: ['german', 'turkish'] });
    expect(guessColumns([['INGILIZCE', 'Meaning'], ['apple', 'elma']], 'en').mapping).toEqual({ hasHeader: true, roles: ['german', 'turkish'] });
    expect(guessColumns([['Word', 'Meaning'], ['apple', 'elma']], 'en').mapping.roles).toEqual(['german', 'turkish']);
    // Articles and plurals are German: an English file's such columns are not used, and no column is read as articles.
    expect(guessColumns([['English', 'Article', 'Türkçe', 'Plural'], ['apple', 'the', 'elma', 'apples']], 'en').mapping.roles).toEqual(['german', 'ignore', 'turkish', 'ignore']);
    expect(guessColumns([['der', 'Apfel', 'elma'], ['', 'essen', 'yemek']], 'en').mapping.roles).not.toContain('article');
    expect(columnRolesFor('en')).toEqual(['german', 'turkish', 'ignore']);
    expect(columnRolesFor('de')).toEqual(['german', 'article', 'turkish', 'plural', 'ignore']);
  });

  it('keeps a German file as it was: English is not its word column, and German headers still are', () => {
    expect(guessColumns([['Almanca', 'English', 'Türkçe'], ['Apfel', 'apple', 'elma']]).mapping.roles).toEqual(['german', 'ignore', 'turkish']);
    expect(guessColumns([['English', 'Deutsch', 'Türkçe'], ['apple', 'Apfel', 'elma']], 'de').mapping.roles).toEqual(['ignore', 'german', 'turkish']);
    expect(guessColumns([['Deutsch', 'Englisch', 'Türkçe'], ['Apfel', 'apple', 'elma']], 'en').mapping).toEqual({ hasHeader: true, roles: ['ignore', 'german', 'turkish'] });
  });

  it('asks a person when the columns cannot be told apart', () => {
    const { confident, mapping } = guessColumns([['a', 'b', 'c', 'd']]);
    expect(confident).toBe(false);
    expect(mapping.roles).toEqual(['german', 'turkish', 'ignore', 'ignore']);
  });

  it('gives each role one column and tells when mapping is complete', () => {
    const start = { hasHeader: false, roles: ['german', 'turkish', 'ignore'] as const };
    const next = assignRole({ ...start, roles: [...start.roles] }, 2, 'german');
    expect(next.roles).toEqual(['ignore', 'turkish', 'german']);
    expect(mappingIsComplete(next)).toBe(true);
    expect(mappingIsComplete(assignRole(next, 1, 'ignore'))).toBe(false);
  });

  it('builds rows, splitting an article only when no article column has one', () => {
    const roles = ['article', 'german', 'turkish', 'plural'] as const;
    const rows = rowsFromTable([['Artikel', 'Almanca', 'Türkçe', 'Çoğul'], ['', 'der Apfel', 'elma', 'Äpfel'], ['die', 'Birne', 'armut', ''], ['den', 'Fehler', 'hata', ''], ['', 'essen', '', '']], { hasHeader: true, roles: [...roles] });
    expect(rows).toEqual([
      { rowIndex: 1, german: 'Apfel', article: 'der', turkish: 'elma', plural: 'Äpfel' },
      { rowIndex: 2, german: 'Birne', article: 'die', turkish: 'armut', plural: '' },
      { rowIndex: 3, german: 'Fehler', article: 'den', turkish: 'hata', plural: '' },
      { rowIndex: 4, german: 'essen', article: '', turkish: '', plural: '' },
    ]);
  });
});

describe('pasted lines', () => {
  it('understands the usual separators', () => {
    for (const line of ['der Apfel - elma', 'der Apfel – elma', 'der Apfel — elma', 'der Apfel = elma', 'der Apfel=elma', 'der Apfel\telma', 'der Apfel; elma', 'der Apfel: elma', 'der Apfel, elma']) {
      expect(splitLine(line), line).toEqual({ german: 'der Apfel', turkish: 'elma' });
    }
  });

  it('does not split on a hyphen inside a word', () => {
    expect(splitLine('die E-Mail - e-posta')).toEqual({ german: 'die E-Mail', turkish: 'e-posta' });
    expect(splitLine('E-Mail')).toEqual({ german: 'E-Mail', turkish: '' });
  });

  it('keeps commas in the meaning when a stronger separator exists', () => {
    expect(splitLine('der Apfel - elma, alma')).toEqual({ german: 'der Apfel', turkish: 'elma, alma' });
  });

  it('reads the article-after form', () => {
    expect(splitLine('Apfel, der, elma')).toEqual({ german: 'Apfel, der', turkish: 'elma' });
  });

  it('keeps a line with no meaning, and skips blank lines', () => {
    const rows = rowsFromLines('der Apfel - elma\n\n   \nessen\r\nGröße - boy, büyüklük');
    expect(rows).toEqual([
      { rowIndex: 0, german: 'Apfel', article: 'der', turkish: 'elma', plural: '' },
      { rowIndex: 3, german: 'essen', article: '', turkish: '', plural: '' },
      { rowIndex: 4, german: 'Größe', article: '', turkish: 'boy, büyüklük', plural: '' },
    ]);
  });
});

describe('choosing how to read the input', () => {
  it('reads pasted text as lines, even when every line has a comma', () => {
    const parsed = parseImportText('der Apfel - elma, alma\ndie Birne - armut, ayva', 'paste');
    expect(parsed.kind).toBe('lines');
  });

  it('reads a pasted spreadsheet selection as a table', () => {
    expect(parseImportText('Apfel\telma\nBirne\tarmut', 'paste').kind).toBe('table');
  });

  it('reads a file as a table when a delimiter fits, and as lines when none does', () => {
    expect(parseImportText('Almanca,Türkçe\nApfel,elma', 'file')).toMatchObject({ kind: 'table', confident: true, mapping: { hasHeader: true } });
    expect(parseImportText('Apfel - elma\nBirne - armut', 'file').kind).toBe('lines');
  });

  it('reads a file for the workspace it goes into', () => {
    expect(parseImportText('English,Türkçe\napple,elma', 'file', 'en')).toMatchObject({ kind: 'table', confident: true, mapping: { hasHeader: true, roles: ['german', 'turkish'] } });
    // German does not know that header, so it reads the file as two unnamed columns, as before.
    expect(parseImportText('English,Türkçe\napple,elma', 'file')).toMatchObject({ kind: 'table', mapping: { hasHeader: false } });
  });
});
