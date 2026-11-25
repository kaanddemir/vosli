import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, test } from 'vitest';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { formatCount, formatDate, formatDateTime, formatDay, formatPercent } from '../src/i18n/format';
import { applyLocale, currentLocale, DEFAULT_LOCALE, interfaceLang, LOCALE_NAMES, loadLocale, LOCALES, savedLocale } from '../src/i18n/locale';
import { t, type Strings } from '../src/i18n/strings';
import { tr } from '../src/i18n/tr';
import { rowsFromLines } from '../src/core/tabular';
import { draftsFor, blankDraft } from '../src/core/review';

afterEach(() => applyLocale(DEFAULT_LOCALE));

type Node = string | ((...args: never[]) => string) | { [key: string]: Node };

function* leaves(node: Node, path = ''): Generator<[string, Exclude<Node, object> | ((...args: never[]) => string)]> {
  if (typeof node === 'object') for (const [key, value] of Object.entries(node)) yield* leaves(value, path ? `${path}.${key}` : key);
  else yield [path, node];
}

const at = (root: Node, path: string): Node => path.split('.').reduce<Node>((node, key) => (node as Record<string, Node>)[key]!, root);

/**
 * Every text a key can produce. A one-element array stands in for every parameter: it reads as a number to the
 * count templates, as text to the others, and as a list to the page lists. One and two cover singular and plural.
 */
const outputs = (value: Node): string[] => {
  if (typeof value === 'string') return [value];
  const call = value as unknown as (...args: unknown[]) => string;
  return [[1], [2], [1284]].map((sample) => call(...Array.from({ length: call.length }, () => sample)));
};

/** The same in every language on purpose: names, licenses and a score. */
const NAMES = ['appName', 'practice.firstTry', 'dictionary.pos.other', 'settings.dictionaryLicense', 'settings.pronunciationSource', 'pronunciation.source'];
/** Words two languages share. Each pair lists its own, so a key left untranslated by mistake still stands out. */
const SAME: Record<'en_tr' | 'de_tr' | 'de_en', Set<string>> = {
  en_tr: new Set([...NAMES, 'collections.kind.pdf', 'practice.studies.test']),
  // The paste example is the learner's own kind of text: German words with the Turkish meanings they study.
  de_tr: new Set([...NAMES, 'collections.kind.pdf', 'practice.studies.test', 'lang.de.pastePlaceholder', 'collections.kind.custom', 'wordForm.article', 'practice.modes.article', 'import.roles.article', 'import.articleField']),
  de_en: new Set([...NAMES, 'collections.kinds.pdf', 'collections.kind.pdf', 'practice.studies.test', 'dictionary.plural', 'dictionary.pos.verb', 'dictionary.pos.adverb', 'wordForm.plural', 'import.roles.plural', 'settings.themes.system']),
};

const OTHERS = { en, de } as const;

describe('the interface languages', () => {
  test('are Turkish, English and German, each named in itself', () => {
    expect(LOCALES).toEqual(['tr', 'en', 'de']);
    expect(LOCALE_NAMES).toEqual({ tr: 'Türkçe', en: 'English', de: 'Deutsch' });
  });

  for (const [name, strings] of Object.entries(OTHERS)) {
    test(`${name} has the same keys as Turkish, each text or a template with the same parameters`, () => {
      const turkish = [...leaves(tr as unknown as Node)];
      expect([...leaves(strings as unknown as Node)].map(([path]) => path)).toEqual(turkish.map(([path]) => path));
      for (const [path, value] of turkish) {
        const other = at(strings as unknown as Node, path);
        expect(typeof other, path).toBe(typeof value);
        if (typeof value === 'function') expect((other as (...args: never[]) => string).length, path).toBe(value.length);
      }
    });

    test(`${name} has no Turkish-only letters`, () => {
      for (const [path, value] of leaves(strings as unknown as Node)) {
        for (const text of outputs(value)) expect(text, path).not.toMatch(/[çğıİşÇĞŞ]/u);
      }
    });
  }

  const pairs: [keyof typeof SAME, Strings, Strings][] = [
    ['en_tr', en, tr],
    ['de_tr', de, tr],
    ['de_en', de, en],
  ];
  for (const [pair, strings, reference] of pairs) {
    test(`${pair.replace('_', ' is translated from ')} everywhere, and never empty where the other has text`, () => {
      for (const [path, value] of leaves(reference as unknown as Node)) {
        const translated = outputs(at(strings as unknown as Node, path));
        const original = outputs(value);
        translated.forEach((text, i) => expect(text === '', path).toBe(original[i] === ''));
        if (!SAME[pair].has(path)) expect(translated, path).not.toEqual(original);
      }
    });
  }

  test('German sets the learner\'s word into a sentence exactly as saved, article and all', () => {
    const word = 'der Apfel';
    let templates = 0;
    for (const [path, value] of leaves(en as unknown as Node)) {
      if (typeof value !== 'function') continue;
      const call = (strings: Node) => (at(strings, path) as unknown as (...args: unknown[]) => string)(...Array.from({ length: value.length }, () => word));
      // Only the templates that take text: a count reads the word as a number, and a page list fails on it.
      const english = (() => {
        try {
          return call(en as unknown as Node);
        } catch {
          return '';
        }
      })();
      if (!english.includes(word)) continue;
      templates += 1;
      const german = call(de as unknown as Node);
      expect(german, path).toContain(word);
      expect(german, path).not.toMatch(/\b(den|dem|des) Apfel/u);
    }
    expect(templates).toBeGreaterThan(20);
    expect(de.dictionary.deleteTitle(word)).toBe('„der Apfel“ löschen?');
    expect(de.collections.removed(word)).toBe('„der Apfel“ wurde aus der Liste entfernt.');
    expect(de.collections.listsOf(word)).toBe('Listen mit „der Apfel“');
    expect(de.dictionary.revealMeaning(word)).toBe('der Apfel: Bedeutung zeigen');
    expect(de.collections.deleteTitle('Lektion 1')).toBe('„Lektion 1“ löschen?');
  });

  test('German quotes with „…“, never with English quotation marks', () => {
    for (const [path, value] of leaves(de as unknown as Node)) {
      for (const text of outputs(value)) expect(text.replace(/„[^„“]*“/gu, ''), path).not.toMatch(/[„“”"]/u);
    }
  });
});

describe('counts', () => {
  test('English says one word and two words, with its own separators', () => {
    expect(en.common.words(0)).toBe('0 words');
    expect(en.common.words(1)).toBe('1 word');
    expect(en.common.words(2)).toBe('2 words');
    expect(en.common.words(1284)).toBe('1,284 words');
    expect(en.review.ready(1)).toBe('1 question ready');
    expect(en.review.ready(10)).toBe('10 questions ready');
    expect(en.home.dueStatus(1)).toBe('1 review ready');
    expect(en.import.commit(1)).toBe('Save 1 row');
    expect(en.import.commit(5000)).toBe('Save 5,000 rows');
    expect(en.practice.hintSpoken('Ap••', 1)).toBe('Hint: Ap••, 1 letter');
    expect(en.import.pdfFacts(1, 12)).toBe('1 page · 12 rows');
    expect(en.import.page([3])).toBe('Page 3');
    expect(en.import.page([3, 5])).toBe('Pages 3, 5');
    expect(en.import.notices.no_table([2])).toBe('No table found, skipped: page 2');
  });

  test('Turkish keeps the noun singular after a number, with its own separators', () => {
    expect(tr.common.words(1)).toBe('1 kelime');
    expect(tr.common.words(1284)).toBe('1.284 kelime');
    expect(tr.review.ready(2)).toBe('2 soru hazır');
    expect(tr.import.page([3, 5])).toBe('Sayfa 3, 5');
  });

  test('German says ein Wort and zwei Wörter, and its adjectives agree', () => {
    expect(de.common.words(0)).toBe('0 Wörter');
    expect(de.common.words(1)).toBe('1 Wort');
    expect(de.common.words(2)).toBe('2 Wörter');
    expect(de.common.words(1284)).toBe('1.284 Wörter');
    expect(de.home.freshStatus(1)).toBe('1 neue Frage');
    expect(de.home.freshStatus(2)).toBe('2 neue Fragen');
    expect(de.home.workspace(1)).toBe('1 Wort');
    expect(de.home.workspace(5000)).toBe('5.000 Wörter');
    // Home's word count names no learning language: the city and the bunting show the workspace.
    expect([en, tr, de].map((strings) => [0, 1, 193].map((n) => strings.home.workspace(n)))).toEqual([
      ['No words yet', '1 word', '193 words'],
      ['Henüz kelime yok', '1 kelime', '193 kelime'],
      ['Noch keine Wörter', '1 Wort', '193 Wörter'],
    ]);
    expect(de.home.dueStatus(1)).toBe('1 Wiederholung bereit');
    expect(de.review.ready(10)).toBe('10 Fragen bereit');
    expect(de.import.commit(1)).toBe('1 Zeile speichern');
    expect(de.practice.hintSpoken('Ap••', 1)).toBe('Tipp: Ap••, 1 Buchstabe');
    expect(de.practice.hintSpoken('Ap••', 3)).toBe('Tipp: Ap••, 3 Buchstaben');
    expect(de.import.notices.reusedPartly(1)).toContain('1 fehlendes Wort kann');
    expect(de.import.notices.reusedPartly(2)).toContain('2 fehlende Wörter können');
    expect(de.import.page([3, 5])).toBe('Seiten 3, 5');
    expect(de.practice.test.score(7, 10)).toBe('7 von 10 richtig');
  });

  test('each language formats its own numbers, whatever language is showing', () => {
    applyLocale('en');
    expect(tr.common.words(1284)).toBe('1.284 kelime');
    expect(de.common.words(1284)).toBe('1.284 Wörter');
    applyLocale('de');
    expect(en.common.words(1284)).toBe('1,284 words');
  });
});

describe('formatting follows the interface language', () => {
  const NOV_4 = Date.UTC(2026, 10, 4, 12);

  test('Turkish', () => {
    applyLocale('tr');
    expect(formatCount(1284)).toBe('1.284');
    expect(formatPercent(0.75)).toBe('%75');
    expect(formatDay(NOV_4)).toBe('4 Kasım Çarşamba');
    expect(formatDate(NOV_4)).toBe('4 Kas 2026');
  });

  test('English', () => {
    applyLocale('en');
    expect(formatCount(1284)).toBe('1,284');
    expect(formatPercent(0.75)).toBe('75%');
    expect(formatDay(NOV_4)).toBe('Wednesday, November 4');
    expect(formatDate(NOV_4)).toBe('Nov 4, 2026');
  });

  test('German', () => {
    applyLocale('de');
    expect(formatCount(1284)).toBe('1.284');
    // A no-break space keeps the sign with its number.
    expect(formatPercent(0.75)).toBe('75\u00a0%');
    expect(formatDay(NOV_4)).toBe('Mittwoch, 4. November');
    expect(formatDate(NOV_4)).toBe('4. Nov. 2026');
    expect(formatDateTime(NOV_4)).toMatch(/^04\.11\.2026, \d{2}:00$/u);
  });
});

describe('the current language', () => {
  test('is English unless Turkish or German was chosen, and a saved choice is always kept', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(currentLocale()).toBe('en');
    let saved: string | null = null;
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => saved }, configurable: true });
    try {
      expect(loadLocale()).toBe('en');
      for (const locale of LOCALES) {
        saved = locale;
        expect(loadLocale()).toBe(locale);
      }
      for (const unknown of ['TR', 'DE', 'de-DE', 'en-US', 'fr', '', ' tr']) {
        saved = unknown;
        expect(loadLocale(), unknown).toBe('en');
      }
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  test('reads back only a language it knows, and survives blocked storage', () => {
    const stored = new Map<string, string>();
    const storage = { getItem: (key: string) => stored.get(key) ?? null };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    try {
      expect(savedLocale()).toBeNull();
      for (const locale of LOCALES) {
        stored.set('vosli.locale', locale);
        expect(savedLocale()).toBe(locale);
      }
      stored.set('vosli.locale', 'klingon');
      expect(savedLocale()).toBeNull();
      storage.getItem = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      expect(savedLocale()).toBeNull();
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  test('the page has the saved language before the app loads', () => {
    const boot = readFileSync(join(import.meta.dirname, '..', 'public', 'theme-boot.js'), 'utf8');
    // The page starts with index.html's own lang, which the script then changes or leaves.
    const staticLang = /<html lang="([^"]+)">/u.exec(readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8'))![1]!;
    expect(staticLang).toBe('en');
    const langAfterBoot = (saved: string | null) => {
      const root = { lang: staticLang, dataset: {} as Record<string, string> };
      runInNewContext(boot, {
        localStorage: { getItem: (key: string) => (key === 'vosli.locale' ? saved : null) },
        document: { documentElement: root, querySelector: () => ({ content: '' }) },
        matchMedia: () => ({ matches: false }),
      });
      return root.lang;
    };
    expect(langAfterBoot(null)).toBe('en');
    expect(langAfterBoot('en')).toBe('en');
    expect(langAfterBoot('tr')).toBe('tr');
    expect(langAfterBoot('de')).toBe('de');
    expect(langAfterBoot('fr')).toBe('en');
    expect(langAfterBoot('TR')).toBe('en');
  });

  test('switches the strings every screen reads', () => {
    expect(t).toBe(en);
    expect(t.nav.home).toBe('Today');
    expect(interfaceLang()).toBe('en');
    applyLocale('tr');
    expect(currentLocale()).toBe('tr');
    expect(t).toBe(tr);
    expect(t.nav.home).toBe('Bugün');
    expect(interfaceLang()).toBe('tr');
    applyLocale('de');
    expect(t).toBe(de);
    expect(t.nav.home).toBe('Heute');
    expect(t.home.smartReview).toBe('Intelligente Wiederholung');
    expect(interfaceLang()).toBe('de');
  });

  test('names backup files in its own words, with the same date stamp', () => {
    expect(tr.settings.backupFileName('2026-11-25-10-30')).toBe('vosli-yedek-2026-11-25-10-30.json');
    expect(en.settings.backupFileName('2026-11-25-10-30')).toBe('vosli-backup-2026-11-25-10-30.json');
    expect(de.settings.backupFileName('2026-11-25-10-30')).toBe('vosli-sicherung-2026-11-25-10-30.json');
  });
});

test('learning logic, storage and audio never depend on the interface language', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));
  for (const area of ['core', 'data', 'audio', 'pdf']) {
    for (const file of files(join(root, area))) expect(readFileSync(file, 'utf8'), file).not.toMatch(/from '[^']*i18n\//u);
  }
});

describe('the paste example', () => {
  test('shows words of each learning language, as the import reads them, in every interface language', () => {
    for (const strings of [en, tr, de]) {
      const german = rowsFromLines(strings.lang.de.pastePlaceholder);
      expect(german.map((row) => [row.article, row.german])).toEqual([['der', 'Apfel'], ['', 'essen'], ['die', 'Bank']]);
      const english = draftsFor('en', rowsFromLines(strings.lang.en.pastePlaceholder).map((row) => blankDraft(String(row.rowIndex), row.rowIndex, row)));
      expect(english.map((row) => [row.article, row.german])).toEqual([['', 'apple'], ['', 'give up'], ['', 'bank']]);
      expect(english.every((row) => row.turkish !== '')).toBe(true);
    }
  });
});

describe('the browser title', () => {
  test('names Vosli and no learning language, since either may be open, in every interface language', () => {
    for (const strings of [en, tr, de]) {
      expect(strings.documentTitle).toMatch(/^Vosli — /u);
      expect(strings.documentTitle).not.toMatch(/German|English|Almanca|İngilizce|Deutsch|Englisch/u);
    }
    expect(en.documentTitle).toBe('Vosli — Learn and Practice Vocabulary');
    expect(tr.documentTitle).toBe('Vosli — Kelime Öğren ve Pratik Yap');
    expect(de.documentTitle).toBe('Vosli — Vokabeln lernen und üben');
  });
});

describe('static metadata and social previews', () => {
  const repo = join(import.meta.dirname, '..');
  const read = (path: string) => readFileSync(join(repo, path), 'utf8');
  const meta = (html: string, attr: string, name: string) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`, 'u').exec(html)?.[1];

  test('the page, link previews and the installed app speak English, the default', () => {
    const html = read('index.html');
    expect(/<html lang="([^"]+)">/u.exec(html)?.[1]).toBe('en');
    expect(/<title>([^<]+)<\/title>/u.exec(html)?.[1]).toBe(en.documentTitle);
    expect(meta(html, 'property', 'og:locale')).toBe('en_US');
    expect(meta(html, 'property', 'og:image')).toBe('https://kaanddemir.github.io/vosli/og/vosli-en.png');
    for (const [attr, name] of [['name', 'description'], ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:image:alt']] as const) {
      expect(meta(html, attr, name), name).toMatch(/German/u);
      expect(meta(html, attr, name), name).not.toMatch(/[çğıİşÇĞŞ]/u);
    }
    const config = read('vite.config.ts');
    expect(config).toMatch(/lang: 'en',/u);
    expect(config).toMatch(new RegExp(`description: '${meta(html, 'name', 'description')!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'u'));
  });

  /** Width and height from a PNG's header. */
  const size = (path: string) => {
    const bytes = readFileSync(join(repo, path));
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  };
  const LINES = { tr: 'Almancayı kelime kelime öğren', en: 'Learn German, word by word', de: 'Deutsch lernen, Wort für Wort' };

  test('each language has its artwork and its source, named after the language', () => {
    for (const [locale, line] of Object.entries(LINES)) {
      expect(size(`public/og/vosli-${locale}.png`), locale).toEqual([1200, 630]);
      const svg = read(`design/og/vosli-${locale}.svg`);
      expect(svg, locale).toContain(`>${line}</text>`);
      expect(svg, locale).toContain(`Source for public/og/vosli-${locale}.png.`);
    }
    expect(readdirSync(join(repo, 'public', 'og')).sort()).toEqual(['vosli-de.png', 'vosli-en.png', 'vosli-tr.png']);
    expect(readdirSync(join(repo, 'design', 'og')).sort()).toEqual(['vosli-de.svg', 'vosli-en.svg', 'vosli-tr.svg']);
  });

  test('nothing points at a preview by an old name', () => {
    for (const path of ['index.html', 'README.md', 'README.tr.md', 'AGENTS.md', 'vite.config.ts', 'design/og/vosli-tr.svg', 'design/og/vosli-en.svg', 'design/og/vosli-de.svg']) {
      expect(read(path), path).not.toMatch(/vosli-de-ui/u);
    }
    expect(read('design/og/vosli-tr.svg')).not.toContain('public/og/vosli-de.png');
  });
});
