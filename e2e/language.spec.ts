import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { LOCALE_NAMES, type Locale } from '../src/i18n/locale';
import type { Strings } from '../src/i18n/strings';
import { tr } from '../src/i18n/tr';
import { buildPdf, tablePage, type VocabRow } from '../tests/support/pdfBuilder';

/**
 * The interface language. It changes menus, buttons and messages only: the learner's words, meanings, collections,
 * schedules and backups read and behave the same in every language.
 */

const STRINGS: Readonly<Record<Locale, Strings>> = { tr, en, de };
const LOCALES = ['tr', 'en', 'de'] as const;
const HTML_LANG: Readonly<Record<Locale, string>> = { tr: 'tr', en: 'en', de: 'de' };

const LOCALE_KEY = 'vosli.locale';
const DAY = 86_400_000;
const PAST = 1_700_000_000_000;

const word = (id: string, lemma: string, article: string | null, meanings: string[], extra: Record<string, unknown> = {}) => ({ id, identityKey: `${lemma}|${article ?? ''}`, lemma, article, pos: article ? 'noun' : 'other', plural: null, meanings: meanings.map((text) => ({ text, note: null })), senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null, ...extra });
const fsrs = (dueAt: number) => ({ stability: 5, difficulty: 5, dueAt, lastReviewAt: dueAt - 5 * DAY, state: 2, scheduleStatus: 'review', reps: 4, lapses: 0, scheduledDays: 5, learningStep: 0 });
const card = (wordId: string, track: string, due: number) => ({ wordId, track, due, fsrs: fsrs(due), schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1' });

const WORDS = [
  word('apfel', 'Apfel', 'der', ['elma'], { plural: 'die Äpfel' }),
  word('tuer', 'Tür', 'die', ['kapı'], { favoritedAt: 2 }),
  word('haus', 'Haus', 'das', ['ev']),
  word('bank', 'Bank', 'die', ['banka']),
  word('hund', 'Hund', 'der', ['köpek']),
  word('danke', 'danke', null, ['teşekkürler']),
];
const LIBRARY = {
  words: WORDS,
  groups: [{ id: 'g1', kind: 'custom', name: 'Şarkılar', order: 0, sourceId: null, createdAt: 1 }],
  groupMembers: ['apfel', 'tuer'].map((wordId) => ({ groupId: 'g1', wordId, addedAt: 1, importRowId: null })),
  cards: [card('hund', 'de_tr', Date.now() + 30 * DAY)],
  reviewLogs: [{ seq: 1, mode: 'practice', wordId: 'apfel', track: 'de_tr', at: PAST, typed: 'elma', result: 'correct', hintsUsed: 0 }],
};

/**
 * The learner's own text, which may be Turkish or German whatever the interface language is, and the language
 * names, each written in itself. Longest first, so parts of it are removed whole.
 */
const DATA = [...new Set([...WORDS.flatMap((w) => [w.lemma, ...w.meanings.map((m) => m.text), w.plural ?? '']), 'Şarkılar', ...Object.values(LOCALE_NAMES)].filter(Boolean))].sort((a, b) => b.length - a.length);

/** Plain text of one language that another replaces, so a screen still showing it is caught even without telltale letters. */
function plainTexts(node: unknown, other: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    if (node !== other && node.length >= 4) found.push(node);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) plainTexts(value, (other as Record<string, unknown>)[key], found);
  }
  return found;
}
/** Every plain text a language uses, wherever it uses it. */
function allTexts(node: unknown, found = new Set<string>()): Set<string> {
  if (typeof node === 'string') found.add(node);
  else if (node && typeof node === 'object') for (const value of Object.values(node)) allTexts(value, found);
  return found;
}
const OWN = { tr: allTexts(tr), en: allTexts(en), de: allTexts(de) };
/**
 * For each interface language, the text of the others it must never show. Text the language itself uses
 * somewhere is left out: German and Turkish both say "Artikel", and that is not a leftover.
 */
const FOREIGN_UI: Readonly<Record<Locale, string[]>> = {
  tr: [...new Set([...plainTexts(en, tr), ...plainTexts(de, tr)])].filter((text) => !OWN.tr.has(text)),
  en: [...new Set([...plainTexts(tr, en), ...plainTexts(de, en)])].filter((text) => !OWN.en.has(text)),
  de: [...new Set([...plainTexts(tr, de), ...plainTexts(en, de)])].filter((text) => !OWN.de.has(text)),
};

async function write(page: Page, tables: Record<string, unknown[]>) {
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(Object.keys(data), 'readwrite');
          for (const [table, rows] of Object.entries(data)) for (const row of rows) tx.objectStore(table).put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    tables,
  );
}

/** Every record in every table, the way a backup would hold them. */
const dumpAll = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names);
          const out: Record<string, unknown[]> = {};
          for (const name of names) {
            const read = tx.objectStore(name).getAll();
            read.onsuccess = () => (out[name] = read.result);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
      }),
  );

const byId = (rows: readonly unknown[]) => [...rows].sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)));

async function open(page: Page, hash = '#/') {
  await page.goto(`./${hash}`);
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
}

async function seeded(page: Page, tables: Record<string, unknown[]> = LIBRARY) {
  await open(page);
  await write(page, tables);
}

/** Starts every page of the test in a language, as a returning learner who chose it. */
const inLocale = (page: Page, locale: Locale) => page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LOCALE_KEY, locale]);

/** Each language is named in itself, so the same name finds it in every interface. */
const languageRadio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

/**
 * Interface text from another language: letters only another interface language has, or a label of a language
 * this one replaces. The learner's own words and the language names are left out.
 */
// German letters stay out of it: the letter keys show them in every interface. Turkish has no letters of its own to check.
const FOREIGN_LETTERS: Readonly<Record<Locale, string>> = { tr: '(?!)', en: '[çğıİşÇĞŞ]', de: '[çğıİşÇĞŞ]' };
async function foreignLeft(page: Page, locale: Locale): Promise<string[]> {
  return page.evaluate(
    ({ data, ui, letters }) => {
      const strip = (text: string) => data.reduce((rest, item) => rest.split(item).join(' '), text).replace(/\s+/g, ' ').trim();
      const found: string[] = [];
      const check = (raw: string, where: string) => {
        const text = strip(raw);
        if (text && (new RegExp(letters, 'u').test(text) || ui.includes(text))) found.push(`${where}: ${raw}`);
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement!;
        if (!parent.closest('script, style')) check((node as Text).data, parent.tagName.toLowerCase());
      }
      const attributes = ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext', 'aria-roledescription'];
      for (const el of document.querySelectorAll(attributes.map((name) => `[${name}]`).join(','))) {
        for (const name of attributes) {
          const value = el.getAttribute(name);
          if (value) check(value, `${el.tagName.toLowerCase()}[${name}]`);
        }
      }
      check(document.title, 'title');
      return found;
    },
    { data: DATA, ui: FOREIGN_UI[locale], letters: FOREIGN_LETTERS[locale] },
  );
}

const pick = (page: Page, name: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${name}$`) }).click();

test.describe('choosing the interface language', () => {
  test('English is the default for a learner who never chose', { tag: '@smoke' }, async ({ page }) => {
    await seeded(page);
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(en.documentTitle);
    await expect(page.getByRole('navigation', { name: en.mainNav }).getByRole('link', { name: en.nav.home })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)).toBeNull();
    await open(page, '#/settings');
    await expect(page.getByRole('radio')).toHaveCount(3 + 3);
    await expect(languageRadio(page, 'English')).toBeChecked();
    await expect(languageRadio(page, 'Türkçe')).not.toBeChecked();
    await expect(languageRadio(page, 'Deutsch')).not.toBeChecked();
  });

  for (const saved of ['tr', 'de'] as const) {
    test(`a learner who chose ${LOCALE_NAMES[saved]} keeps it`, async ({ page }) => {
      await inLocale(page, saved);
      await open(page, '#/settings');
      await expect(page.locator('html')).toHaveAttribute('lang', HTML_LANG[saved]);
      await expect(page).toHaveTitle(STRINGS[saved].documentTitle);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(STRINGS[saved].settings.title);
      await expect(languageRadio(page, LOCALE_NAMES[saved])).toBeChecked();
    });
  }

  for (const unknown of ['fr', 'TR', 'de-DE', '']) {
    test(`an unknown saved value "${unknown}" reads as English`, async ({ page }) => {
      await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LOCALE_KEY, unknown]);
      await open(page, '#/settings');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.settings.title);
      await expect(languageRadio(page, 'English')).toBeChecked();
    });
  }

  test('English → Türkçe → Deutsch → English, each at once and each kept after a reload', { tag: '@smoke' }, async ({ page }) => {
    await open(page, '#/settings');
    for (const locale of ['tr', 'de', 'en'] as const) {
      const strings = STRINGS[locale];
      await pick(page, LOCALE_NAMES[locale]);
      // No reload: the screen, the menu and the document all follow straight away.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.settings.title);
      await expect(page.getByRole('navigation', { name: strings.mainNav }).getByRole('link', { name: strings.nav.home })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', HTML_LANG[locale]);
      await expect(page).toHaveTitle(strings.documentTitle);
      await expect(languageRadio(page, LOCALE_NAMES[locale])).toBeChecked();
      expect(await page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)).toBe(locale);

      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.settings.title);
      await expect(page.locator('html')).toHaveAttribute('lang', HTML_LANG[locale]);
      await expect(page).toHaveTitle(strings.documentTitle);
      await expect(languageRadio(page, LOCALE_NAMES[locale])).toBeChecked();
    }
  });

  test('a saved German choice is on the page before the app starts', async ({ page }) => {
    await inLocale(page, 'de');
    // What the boot script set, read before any module of the app has run.
    await page.addInitScript(() => addEventListener('DOMContentLoaded', () => ((window as unknown as { bootLang: string }).bootLang = document.documentElement.lang)));
    await open(page);
    expect(await page.evaluate(() => (window as unknown as { bootLang: string }).bootLang)).toBe('de');
    await expect(page.getByRole('navigation', { name: de.mainNav }).getByRole('link', { name: de.nav.home })).toBeVisible();
  });

  test('the choice works from the keyboard, keeps focus, and names each language in its own language', async ({ page, browserName, isMobile }) => {
    test.skip(browserName === 'webkit' || isMobile, 'Arrow keys move between radios on desktop Chromium');
    await open(page, '#/settings');
    const radios = { tr: languageRadio(page, 'Türkçe'), en: languageRadio(page, 'English'), de: languageRadio(page, 'Deutsch') };
    for (const locale of ['tr', 'en', 'de'] as const) await expect(page.locator('label', { has: radios[locale] }).locator('span')).toHaveAttribute('lang', HTML_LANG[locale]);
    await radios.en.focus();
    // Right to German, then around to Turkish, as radio groups wrap, and back to English.
    for (const locale of ['de', 'tr', 'en'] as const) {
      await page.keyboard.press('ArrowRight');
      await expect(radios[locale]).toBeChecked();
      await expect(radios[locale]).toBeFocused();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(STRINGS[locale].settings.title);
    }
    await page.keyboard.press('ArrowLeft');
    await expect(radios.tr).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr.settings.title);
  });

  test('switching keeps the screen as it is: the same elements, the scroll position and the focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 });
    await open(page, '#/settings');
    const radio = languageRadio(page, 'Türkçe');
    await page.evaluate(() => window.scrollTo(0, 24));
    await page.evaluate(() => {
      // Marks on the live elements: a remount would replace them with fresh ones.
      (document.querySelector('main') as HTMLElement & { probe?: number }).probe = 1;
      (document.querySelector('input[name=language][value=tr]') as HTMLElement & { probe?: number }).probe = 1;
    });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    for (const [name, locale] of [['Türkçe', 'tr'], ['Deutsch', 'de'], ['English', 'en']] as const) {
      await languageRadio(page, name).focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(STRINGS[locale].settings.title);
      await expect(languageRadio(page, name)).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    }
    expect(await page.evaluate(() => [(document.querySelector('main') as HTMLElement & { probe?: number }).probe, (document.querySelector('input[name=language][value=tr]') as HTMLElement & { probe?: number }).probe])).toEqual([1, 1]);
    await expect(radio).not.toBeChecked();
  });

  test('a status message in the old language does not stay behind', async ({ page }) => {
    await open(page, '#/settings');
    await page.locator('input[type=file]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
    await expect(page.getByRole('status').filter({ hasText: en.restore.rejected })).toBeVisible();
    await pick(page, 'Deutsch');
    await expect(page.getByText(en.restore.rejected)).toHaveCount(0);
  });
});

test.describe('learning data stays as it is', () => {
  test('switching between all three changes nothing stored, and Turkish meanings show unchanged', async ({ page }) => {
    await seeded(page);
    await open(page, '#/settings');
    const before = await dumpAll(page);
    for (const locale of LOCALES) {
      await pick(page, LOCALE_NAMES[locale]);
      await open(page, '#/dictionary/tuer');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Tür');
      await expect(page.getByRole('main').locator('[lang="tr"]').filter({ hasText: 'kapı' })).toBeVisible();
      await open(page, '#/collections/g1');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Şarkılar');
      await expect(page.getByRole('main').locator('[lang="de"]').filter({ hasText: 'Apfel' }).first()).toBeVisible();
      await open(page, '#/settings');
    }
    await pick(page, 'Deutsch');
    await pick(page, 'English');
    await pick(page, 'Türkçe');
    expect(await dumpAll(page)).toEqual(before);
  });

  for (const locale of LOCALES) {
    const strings = STRINGS[locale];

    test(`Smart Review in ${locale} schedules exactly as before and keeps what was typed`, async ({ page }) => {
      await inLocale(page, locale);
      const later = Date.now() + 30 * DAY;
      await seeded(page, { words: [WORDS[2]!], cards: [card('haus', 'de_tr', Date.now() - DAY), card('haus', 'tr_de', later), card('haus', 'article', later)] });
      await open(page, '#/review');
      await expect(page.getByTestId('practice-question')).toContainText('Haus');
      await page.getByLabel(strings.practice.answerLabel).fill('ev');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('practice-feedback')).toContainText(strings.practice.correct);
      const { reviewLogs, cards, words } = await dumpAll(page);
      expect(reviewLogs).toEqual([expect.objectContaining({ mode: 'scheduled', wordId: 'haus', track: 'de_tr', typed: 'ev', result: 'correct', grade: 'good' })]);
      const reviewed = (cards as { track: string; fsrs: { reps: number; dueAt: number } }[]).find((c) => c.track === 'de_tr')!;
      expect(reviewed.fsrs.reps).toBe(5);
      expect(reviewed.fsrs.dueAt).toBeGreaterThan(Date.now());
      expect(words).toEqual([WORDS[2]]);
    });

    test(`Free Practice in ${locale} marks answers by the same rules and records history only`, async ({ page }) => {
      await inLocale(page, locale);
      await seeded(page, { words: [WORDS[0]!] });
      await open(page, '#/practice');
      await pick(page, strings.practice.studies.typed);
      await pick(page, strings.practice.modes.de_tr);
      await page.getByRole('button', { name: strings.practice.start, exact: true }).click();
      await page.getByLabel(strings.practice.answerLabel).fill('Elma');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('practice-feedback')).toContainText(strings.practice.correct);
      const { reviewLogs, cards } = await dumpAll(page);
      expect(cards).toEqual([]);
      expect(reviewLogs).toEqual([expect.objectContaining({ mode: 'practice', typed: 'Elma', result: 'correct' })]);
    });
  }

  test('a backup made in any language restores in any other, and only its file name differs', async ({ page }) => {
    await seeded(page);
    await open(page, '#/settings');
    const save = async (button: string) => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
      return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') };
    };
    const NAME: Readonly<Record<Locale, RegExp>> = {
      tr: /^vosli-yedek-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/,
      en: /^vosli-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/,
      de: /^vosli-sicherung-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/,
    };
    const files = {} as Record<Locale, { name: string; text: string }>;
    for (const locale of ['tr', 'en', 'de'] as const) {
      await pick(page, LOCALE_NAMES[locale]);
      files[locale] = await save(STRINGS[locale].settings.download);
      expect(files[locale].name).toMatch(NAME[locale]);
    }
    const tables = (text: string) => {
      const { exportedAt: _, tables } = JSON.parse(text) as { exportedAt: number; tables: Record<string, unknown[]> };
      return { ...tables, meta: tables.meta!.filter((row) => (row as { key: string }).key !== 'lastBackupAt') };
    };
    for (const locale of ['en', 'de'] as const) {
      expect(tables(files[locale].text)).toEqual(tables(files.tr.text));
      expect(Object.keys(JSON.parse(files[locale].text))).toEqual(Object.keys(JSON.parse(files.tr.text)));
    }

    // Each file restored with another interface: Turkish in German, German in English, English in Turkish.
    for (const [file, locale] of [['tr', 'de'], ['de', 'en'], ['en', 'tr']] as const) {
      const strings = STRINGS[locale];
      await pick(page, LOCALE_NAMES[locale]);
      await write(page, { words: [word(`extra-${file}`, `Extra${file}`, null, ['fazla'])] });
      await page.locator('input[type=file]').setInputFiles({ name: files[file].name, mimeType: 'application/json', buffer: Buffer.from(files[file].text) });
      await page.getByRole('dialog', { name: strings.restore.title }).getByRole('button', { name: strings.restore.confirm }).click();
      await expect(page.getByRole('status').filter({ hasText: strings.restore.done })).toBeVisible();
      expect(byId((await dumpAll(page)).words!)).toEqual(byId(WORDS));
    }
  });
});

test.describe('Reset all data keeps the interface language', () => {
  for (const locale of ['tr', 'en', 'de'] as const) {
    test(`${LOCALE_NAMES[locale]} before, ${LOCALE_NAMES[locale]} after, with everything else gone`, async ({ page }) => {
      const strings = STRINGS[locale];
      await inLocale(page, locale);
      await seeded(page);
      await page.evaluate(() => localStorage.setItem('vosli.theme', 'dark'));
      await open(page, '#/settings');
      await page.getByRole('button', { name: strings.settings.reset }).click();
      const dialog = page.getByRole('dialog', { name: strings.settings.resetTitle });
      await expect(dialog).toContainText(strings.settings.resetBody);
      await dialog.getByRole('button', { name: strings.settings.resetConfirm }).click();

      await expect(page.locator('.today-support')).toHaveText(strings.home.emptySupport);
      await expect(page.getByRole('status').filter({ hasText: strings.settings.resetDone })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', HTML_LANG[locale]);
      await expect(page).toHaveTitle(strings.documentTitle);
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('vosli.')));
      expect(stored).toEqual(['vosli.locale']);
      expect(await page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)).toBe(locale);
      const { words, cards, reviewLogs, groups } = await dumpAll(page);
      expect([words, cards, reviewLogs, groups]).toEqual([[], [], [], []]);
    });
  }

  test('an invalid saved value is cleared like any other setting, and the fresh start is in English', async ({ page }) => {
    await page.addInitScript(([key]) => {
      if (!sessionStorage.getItem('seeded')) localStorage.setItem(key!, 'klingon');
      sessionStorage.setItem('seeded', '1');
    }, [LOCALE_KEY]);
    await seeded(page);
    await open(page, '#/settings');
    await page.getByRole('button', { name: en.settings.reset }).click();
    await page.getByRole('dialog', { name: en.settings.resetTitle }).getByRole('button', { name: en.settings.resetConfirm }).click();
    await expect(page.getByRole('status').filter({ hasText: en.settings.resetDone })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('vosli.')))).toEqual([]);
  });
});

for (const locale of LOCALES) {
  const strings = STRINGS[locale];
  const left = (page: Page) => foreignLeft(page, locale);

  test.describe(`no other interface language's text in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await inLocale(page, locale);
      await seeded(page);
    });

    test('on every screen', async ({ page }) => {
      for (const route of ['#/', '#/dictionary', '#/dictionary/apfel', '#/dictionary/apfel/edit', '#/dictionary/new', '#/collections', '#/collections/g1', '#/practice', '#/review', '#/import', '#/settings']) {
        await open(page, route);
        expect(await left(page), route).toEqual([]);
      }
    });

    test('in confirmation dialogs', async ({ page }) => {
      await open(page, '#/settings');
      await page.getByRole('button', { name: strings.settings.reset }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await left(page)).toEqual([]);
      await page.getByRole('dialog').getByRole('button', { name: strings.common.cancel }).click();
      await open(page, '#/dictionary/apfel');
      await page.getByRole('button', { name: strings.dictionary.deleteWord }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // The word stands in the question as the learner saved it.
      await expect(dialog.getByRole('heading')).toHaveText(strings.dictionary.deleteTitle('der Apfel'));
      expect(await left(page)).toEqual([]);
    });

    test('in every study mode', async ({ page }) => {
      await open(page, '#/practice');
      for (const study of Object.values(strings.practice.studies)) {
        await pick(page, study);
        if (study === strings.practice.studies.listen) await expect(page.getByTestId('practice-coverage').or(page.getByTestId('practice-blocked'))).toBeVisible();
        expect(await left(page), study).toEqual([]);
      }
    });

    test('while typing answers, and in their feedback', async ({ page }) => {
      await open(page, '#/practice');
      await pick(page, strings.practice.studies.typed);
      await page.getByRole('button', { name: strings.practice.start, exact: true }).click();
      await expect(page.getByTestId('practice-question')).toBeVisible();
      expect(await left(page)).toEqual([]);
      await page.getByLabel(strings.practice.answerLabel).fill('xyz');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('practice-feedback')).toBeVisible();
      expect(await left(page)).toEqual([]);
      // Labels are read in the interface language, the learner's words in their own.
      for (const note of await page.getByTestId('practice-feedback').locator('.feedback-note').all()) {
        const lang = await note.getAttribute('lang');
        if (lang === 'tr') expect(await note.textContent()).not.toContain(`${strings.practice.meaning}:`);
      }
    });

    test('in a Test and its results', async ({ page }) => {
      await open(page, '#/practice');
      await pick(page, strings.practice.studies.test);
      await page.getByRole('button', { name: strings.practice.test.start }).click();
      await expect(page.getByTestId('test-option').first()).toBeVisible();
      expect(await left(page)).toEqual([]);
      await page.getByTestId('test-option').first().click();
      await page.getByRole('button', { name: strings.practice.test.submit }).click();
      await expect(page.getByRole('button', { name: strings.practice.test.next }).or(page.getByRole('button', { name: strings.practice.test.results }))).toBeVisible();
      expect(await left(page)).toEqual([]);
    });

    test('on flashcards', async ({ page }) => {
      await open(page, '#/practice');
      await pick(page, strings.practice.studies.cards);
      await page.getByRole('button', { name: strings.practice.startCards }).click();
      await expect(page.getByRole('button', { name: strings.practice.cards.next })).toBeVisible();
      expect(await left(page)).toEqual([]);
    });

    test('in Smart Review', async ({ page }) => {
      await open(page, '#/review');
      await expect(page.getByTestId('practice-question')).toBeVisible();
      expect(await left(page)).toEqual([]);
      await page.getByLabel(strings.practice.answerLabel).fill('xyz');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('practice-feedback')).toBeVisible();
      expect(await left(page)).toEqual([]);
    });

    test('while checking pasted words', async ({ page }) => {
      await open(page, '#/import');
      await page.getByLabel(strings.import.pasteLabel).fill('der Apfel - elma\nder Ball - top\nHaus - ev');
      await page.getByRole('button', { name: strings.import.next }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.import.reviewTitle);
      expect(await left(page)).toEqual([]);
    });
  });

  test.describe(`PDF import in ${locale}`, () => {
    const ROWS: readonly VocabRow[] = [['Apfel', 'der', 'elma'], ['Birne', 'die', 'armut'], ['essen', '-', 'yemek yemek'], ['Straße', 'die', 'cadde, yol']];
    const file = () => ({ name: 'ders-1.pdf', mimeType: 'application/pdf', buffer: Buffer.from(buildPdf([tablePage(ROWS, { heading: 'Lektion 1' })])) });

    test('imports a PDF as written, and a second import of the same file adds nothing', async ({ page }) => {
      await inLocale(page, locale);
      await open(page, '#/import');
      await page.locator('input[type=file]').setInputFiles(file());
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.import.reviewTitle, { timeout: 30_000 });
      expect(await left(page)).toEqual([]);
      await page.locator('.review-commit .btn-primary').click();
      await page.getByRole('dialog').getByRole('button', { name: strings.common.save }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.import.doneTitle);
      expect(await left(page)).toEqual([]);
      const first = await dumpAll(page);
      expect((first.words as { lemma: string; meanings: { text: string }[] }[]).map((w) => [w.lemma, w.meanings.map((m) => m.text)])).toEqual(
        expect.arrayContaining([['Apfel', ['elma']], ['Birne', ['armut']], ['essen', ['yemek yemek']], ['Straße', ['cadde', 'yol']]]),
      );

      await open(page, '#/import');
      await page.locator('input[type=file]').setInputFiles(file());
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.import.reviewTitle, { timeout: 30_000 });
      await expect(page.getByRole('main')).toContainText(strings.import.notices.reused);
      const again = await dumpAll(page);
      expect(again.words).toEqual(first.words);
      expect(again.sources).toEqual(first.sources);
    });
  });
}

test.describe('the answer help row in every language', () => {
  // Turkish "İpucu" with its icon is the widest single word here: it once overflowed the row by 2px.
  for (const locale of ['tr', 'en', 'de'] as const) {
    test(`stays inside the row at 320px with 200% text, icon and label whole, in ${locale}`, async ({ page }) => {
      const strings = STRINGS[locale];
      await page.setViewportSize({ width: 320, height: 640 });
      await page.addInitScript(([key, value]) => {
        localStorage.setItem(key!, value!);
        addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = '32px'));
      }, [LOCALE_KEY, locale]);
      await seeded(page, { words: [WORDS[0]!] });
      await open(page, '#/review');
      const hint = page.locator('.practice-hint');
      await expect(hint).toHaveText(strings.practice.hint);
      const fit = () =>
        page.locator('.practice-help').evaluate((row) => {
          const edge = row.getBoundingClientRect().right;
          return [...row.children].map((el) => ({ past: el.getBoundingClientRect().right - edge > 0.5, spills: el.scrollWidth > el.clientWidth + 1 }));
        });
      expect(await fit()).toEqual([{ past: false, spills: false }, { past: false, spills: false }]);
      expect((await hint.locator('svg').boundingBox())!.width).toBe(40);
      expect((await hint.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  }
});

for (const locale of LOCALES) {
  const strings = STRINGS[locale];

  test.describe(`layout and accessibility in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await inLocale(page, locale);
    });

    /** Anything past the screen edge, or text that spills out of its box (as in ui-quality.spec.ts). */
    const overflowing = (page: Page) =>
      page.evaluate(() => {
        const opticalOverhang = (el: Element) => {
          const button = el.querySelector('.page-actions .icon-btn, .practice-bar .icon-btn');
          if (!button || !button.getBoundingClientRect().width) return 0;
          return (button.getBoundingClientRect().width - (button.querySelector('svg')?.getBoundingClientRect().width ?? 0)) / 2;
        };
        return [...document.querySelectorAll('body *')]
          .filter((el) => !el.closest('.visually-hidden, .skip-link') && !el.matches('.visually-hidden, input, svg, svg *'))
          .filter((el) => {
            const box = el.getBoundingClientRect();
            const pastEdge = box.width > 0 && box.right > document.documentElement.clientWidth + 0.5;
            const spills = el.scrollWidth > el.clientWidth + 1 + opticalOverhang(el) && getComputedStyle(el).display !== 'inline';
            return pastEdge || spills;
          })
          .map((el) => el.className || el.tagName);
      });

    const ROUTES = ['#/', '#/dictionary', '#/dictionary/apfel', '#/collections', '#/collections/g1', '#/practice', '#/review', '#/import', '#/settings'];

    for (const [width, rootPx] of [[320, 16], [320, 32], [390, 32], [1280, 16]] as const) {
      test(`nothing overflows at ${width}px with ${rootPx}px text`, async ({ page }) => {
        await page.setViewportSize({ width, height: 640 });
        if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
        await seeded(page);
        const found: Record<string, string[]> = {};
        for (const route of ROUTES) {
          await open(page, route);
          if (route === '#/review') await expect(page.getByTestId('practice-question')).toBeVisible();
          found[route] = await overflowing(page);
        }
        await open(page, '#/settings');
        await page.getByRole('button', { name: strings.settings.reset }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        found.resetDialog = await overflowing(page);
        await open(page, '#/practice');
        for (const study of Object.values(strings.practice.studies)) {
          await pick(page, study);
          found[study] = await overflowing(page);
        }
        await pick(page, strings.practice.studies.test);
        await page.getByRole('button', { name: strings.practice.test.start }).click();
        await page.getByTestId('test-option').first().click();
        found.test = await overflowing(page);
        expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length > 0))).toEqual({});
      });
    }

    test('menu labels stay on one line at 320px', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await open(page);
      const heights = await page.locator('.nav-link span').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(Math.max(...heights)).toBeLessThan(20);
    });

    for (const scheme of ['light', 'dark'] as const) {
      test(`no detectable accessibility problems in ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await seeded(page);
        for (const route of ROUTES) {
          await open(page, route);
          await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
          const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          expect(violations.map((v) => `${route}: ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
        }
      });
    }
  });
}
