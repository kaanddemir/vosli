import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const ROUTES = ['#/', '#/dictionary', '#/collections', '#/practice', '#/review', '#/import', '#/settings'];

async function open(page: Page, hash = '#/') {
  await page.goto(`./${hash}`);
  // Hash-only moves do not reload, and some tests seed data first, so always start the app fresh.
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
}

const word = (i: number) => ({ id: `w${i}`, identityKey: `Wort${i}|`, lemma: `Wort${i}`, article: null, pos: 'other', plural: null, meanings: [{ text: 'çeviri', note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });
const emptyBackup = () => ({ app: 'vosli', backupVersion: 1, schemaVersion: 1, exportedAt: 1_780_000_000_000, tables: { words: [] as unknown[], cards: [] as unknown[], reviewLogs: [] as unknown[], groups: [], groupMembers: [], sources: [], importRows: [], meta: [] } });
const asFile = (data: unknown) => ({ name: 'yedek.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

/**
 * Anything past the screen edge, or text that spills out of its box. Rows ending in an icon button overhang
 * by half its unused tap area on purpose, so the icon lines up with the content edge; that overhang is allowed.
 */
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

test.describe('worst-case layout', () => {
  for (const [width, height, rootPx] of [[320, 640, 16], [360, 740, 16], [667, 375, 16], [320, 640, 24], [390, 780, 32]] as const) {
    test(`no overflow and an uncovered page at ${width}x${height}, ${rootPx}px text`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
      for (const route of ROUTES) {
        await open(page, route);
        expect(await overflowing(page), `${route}`).toEqual([]);
        if (route === '#/practice' || route === '#/review') continue; // A session has no menu to clear.
        const nav = page.getByRole('navigation', { name: t.mainNav });
        const navHeight = (await nav.boundingBox())!.height;
        const clearance = await page.locator('main').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
        expect(clearance).toBeGreaterThan(navHeight);
      }
    });
  }
});

test('enlarged text does not overflow before Fira Sans has loaded', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.route('**/*.woff2', (route) => route.abort());
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = '32px')));
  for (const route of ROUTES) {
    await open(page, route);
    expect(await overflowing(page), route).toEqual([]);
  }
});

test('menu labels stay on one line at 320px with normal text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const route of ROUTES.filter((r) => r !== '#/practice' && r !== '#/review')) {
    await open(page, route);
    const heights = await page.locator('.nav-link span').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(Math.max(...heights), route).toBeLessThan(20);
  }
});

test.describe('loading', () => {
  test('home never shows the review card before the empty state', async ({ page }) => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      new MutationObserver(() => {
        const text = document.querySelector('.today-support')?.textContent;
        if (text && seen.at(-1) !== text) seen.push(text);
      }).observe(document, { childList: true, subtree: true });
    });
    await open(page);
    await expect(page.getByText(t.home.emptySupport)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([t.home.emptySupport]);
  });
});

test.describe('interaction feedback', () => {
  test.skip(({ isMobile }) => isMobile, 'Uses a mouse');

  test('buttons respond to hover and press', async ({ page }) => {
    await open(page);
    const button = page.getByRole('main').getByRole('link', { name: t.nav.import });
    const read = () => button.evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, transform: getComputedStyle(el).transform }));
    const rest = await read();
    await button.hover();
    await expect.poll(async () => (await read()).background).not.toBe(rest.background);
    await page.mouse.down();
    await expect.poll(async () => (await read()).transform).not.toBe('none');
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });

  test('press feedback drops movement when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const button = page.getByRole('main').getByRole('link', { name: t.nav.import });
    await button.hover();
    await page.mouse.down();
    expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });

  test('controls opt out of the tap flash and text selection, content does not', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color'))).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
    const select = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect);
    expect(await select('.btn')).toBe('none');
    expect(await select('.nav-link')).toBe('none');
    expect(await select('h1')).not.toBe('none');
  });
});

test.describe('restore safeguards', () => {
  test.skip(({ isMobile }) => isMobile, 'Covered on desktop');

  test('explains a broken file in plain language, without ids', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, '#/settings');
    const id = 'bartholomew.fitzgerald-northwind-industries-holdings-00000000-0000-4000-8000-000000000000';
    const fsrs = { stability: 1, difficulty: 5, dueAt: 1, lastReviewAt: null, state: 0, scheduleStatus: 'new', reps: 0, lapses: 0, scheduledDays: 0, learningStep: 0 };
    const backup = emptyBackup();
    backup.tables.cards = [1, 2, 3].map((n) => ({ wordId: `${id}${n}`, track: 'de_tr', due: 1, fsrs, schedulerVersion: 'x' }));
    await page.locator('input[type=file]').setInputFiles(asFile(backup));
    const status = page.getByRole('status').filter({ hasText: t.restore.rejected });
    await expect(status).toContainText(t.restore.errors.broken_reference);
    await expect(status).not.toContainText('bartholomew');
    await expect(status).not.toContainText('cards');
  });

  test('formats large counts and a double click restores once', async ({ page }) => {
    await open(page, '#/settings');
    const backup = emptyBackup();
    backup.tables.words = Array.from({ length: 1284 }, (_, i) => word(i));
    await page.locator('input[type=file]').setInputFiles(asFile(backup));
    const dialog = page.getByRole('dialog', { name: t.restore.title });
    await expect(dialog).toContainText('1.284');
    await expect(dialog.getByRole('button', { name: t.common.cancel })).toBeFocused();

    let downloads = 0;
    page.on('download', () => downloads++);
    await dialog.getByRole('button', { name: t.restore.confirm }).evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
    await expect(page.getByRole('status').filter({ hasText: t.restore.done })).toBeVisible();
    await page.waitForTimeout(300);
    expect(downloads).toBe(1);
  });

  test('cancel and Escape return focus to the restore button', async ({ page }) => {
    await open(page, '#/settings');
    const restore = page.getByRole('button', { name: t.settings.restore });
    const dialog = page.getByRole('dialog', { name: t.restore.title });
    await page.locator('input[type=file]').setInputFiles(asFile(emptyBackup()));
    await dialog.getByRole('button', { name: t.common.cancel }).click();
    await expect(restore).toBeFocused();
    await page.locator('input[type=file]').setInputFiles(asFile(emptyBackup()));
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(restore).toBeFocused();
  });
});

test.describe('high contrast', () => {
  test('the selected theme and current page stay distinguishable in forced colors', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Forced colors can only be emulated in Chromium');
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, '#/settings');
    const outline = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(await outline('.segmented input:checked + span')).toBe('solid');
    expect(await outline('.nav-link[aria-current="page"]')).toBe('solid');
  });
});

test.describe('focus', () => {
  test('the bottom menu focus ring stays on screen', async ({ page, browserName, isMobile }) => {
    test.skip(browserName === 'webkit' || isMobile, 'Tab skips links in Safari by default');
    await page.setViewportSize({ width: 390, height: 780 });
    await open(page);
    const link = page.getByRole('navigation', { name: t.mainNav }).getByRole('link', { name: t.nav.home });
    await page.keyboard.press('Tab'); // Skip link
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    expect(await link.evaluate((el) => parseFloat(getComputedStyle(el).outlineOffset))).toBeLessThan(0);
  });
});

// ---- The redesign's data screens, fed through IndexedDB the way real data arrives.
const longName = 'Bölüm 1 — Kelime listesi 2026 (son hali, düzeltilmiş) kopya.pdf';
const makeWord = (id: string, lemma: string, article: string | null, meanings: string[], plural: string | null = null) => ({ id, identityKey: `${lemma}|${article ?? ''}`, lemma, article, pos: article ? 'noun' : 'other', plural, meanings: meanings.map((text) => ({ text, note: null })), senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });
const LIBRARY = {
  words: [
    makeWord('apfel', 'Apfel', 'der', ['elma'], 'die Äpfel'),
    makeWord('fuss', 'Fuß', 'der', ['ayak']),
    makeWord('long', 'Donaudampfschifffahrtsgesellschaft', 'die', ['Tuna buharlı gemi işletmeciliği şirketi']),
    makeWord('spinat', 'Spinat', 'der', ['ıspanak']),
    ...Array.from({ length: 120 }, (_, i) => makeWord(`z${i}`, `Zzz${String(i).padStart(3, '0')}`, null, ['çeviri'])),
  ],
  groups: [{ id: 'g1', kind: 'pdf', name: longName, order: 0, sourceId: null, createdAt: 1 }],
  groupMembers: [{ groupId: 'g1', wordId: 'apfel', addedAt: 1, importRowId: null }],
};

async function seedLibrary(page: Page) {
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
        };
      }),
    LIBRARY,
  );
}

test.describe('dictionary', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await seedLibrary(page);
  });

  test('searches both languages without special letters, and clears', async ({ page }) => {
    await open(page, '#/dictionary');
    const search = page.getByRole('searchbox', { name: t.dictionary.searchLabel });
    const rows = page.locator('.row-press');
    await search.fill('fuss');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Fuß');
    await search.fill('ispanak');
    await expect(rows.first()).toContainText('Spinat');
    await search.fill('qqqq');
    await expect(page.getByText(t.dictionary.noResults('qqqq'))).toBeVisible();
    await page.getByRole('button', { name: t.dictionary.clear }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
  });

  test('long lists show in pages', async ({ page }) => {
    await open(page, '#/dictionary');
    await expect(page.locator('.row-press')).toHaveCount(100);
    await page.getByRole('button', { name: t.common.more }).click();
    await expect(page.locator('.row-press')).toHaveCount(124);
    await expect(page.getByRole('button', { name: t.common.more })).toHaveCount(0);
  });

  test('a word opens its details and the back link returns', async ({ page }) => {
    await open(page, '#/dictionary');
    await page.getByRole('link', { name: /der Apfel/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('der Apfel');
    await expect(page.getByRole('main')).toContainText('die Äpfel');
    await expect(page.locator('main')).toBeFocused();
    await page.getByRole('main').getByRole('link', { name: t.nav.dictionary }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.dictionary.title);
  });

  test('a missing word says so', async ({ page }) => {
    await open(page, '#/dictionary/nope');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.dictionary.notFound);
  });
});

test.describe('collections', () => {
  test('opens a collection, then a word, and goes back the same way', async ({ page }) => {
    await open(page);
    await seedLibrary(page);
    await open(page, '#/collections');
    await page.getByRole('link', { name: new RegExp('Bölüm 1') }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(longName);
    await page.getByRole('link', { name: /der Apfel/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('der Apfel');
    await page.getByRole('main').getByRole('link', { name: t.nav.collections }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(longName);
  });
});

test.describe('worst-case data', () => {
  for (const [width, rootPx] of [[320, 16], [320, 24], [1280, 16]] as const) {
    test(`data screens hold at ${width}px, ${rootPx}px text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
      await open(page);
      await seedLibrary(page);
      for (const route of ['#/', '#/dictionary', '#/dictionary/long', '#/dictionary/apfel', '#/collections', '#/collections/g1']) {
        await open(page, route);
        expect(await overflowing(page), route).toEqual([]);
      }
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`data screens have no detectable accessibility problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await seedLibrary(page);
      for (const route of ['#/', '#/dictionary', '#/dictionary/apfel', '#/collections', '#/collections/g1']) {
        await open(page, route);
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${route}: ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      }
    });
  }
});

test.describe('home', () => {
  const fsrs = (dueAt: number) => ({ stability: 1, difficulty: 5, dueAt, lastReviewAt: 0, state: 2, scheduleStatus: 'review', reps: 3, lapses: 0, scheduledDays: 1, learningStep: 0 });
  const card = (wordId: string, track: string, due: number) => ({ wordId, track, due, fsrs: fsrs(due), schedulerVersion: 'x' });
  /** Words with one review card each, due long ago, so only active words with real cards are counted. */
  const dueWords = (count: number) => ({
    words: Array.from({ length: count }, (_, i) => ({ ...word(i), id: `c${i}`, identityKey: `Xqzw${i}|`, lemma: `Xqzw${i}` })),
    cards: Array.from({ length: count }, (_, i) => card(`c${i}`, 'de_tr', 1)),
  });
  /** A word with every skill scheduled far ahead, so nothing is left to do. */
  const allScheduled = (id: string) => ['de_tr', 'tr_de', 'article'].map((track) => card(id, track, 9_999_999_999_999));

  async function seedHome(page: Page, tables: Record<string, unknown[]>) {
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
          };
        }),
      tables,
    );
  }

  const heading = (page: Page) => page.getByRole('heading', { level: 1 });
  const main = (page: Page) => page.getByRole('main');

  test('with no words: Import is the one action available, and the empty dictionary is named', async ({ page }) => {
    await open(page);
    await expect(heading(page)).toHaveText(t.home.title);
    await expect(main(page)).toContainText(t.home.emptySupport);
    await expect(main(page).locator('.btn-primary')).toHaveText(t.nav.import);
    await expect(main(page).locator('.btn-primary')).toHaveCount(1);
    for (const name of [t.home.smartReview, t.home.freePractice]) {
      await expect(page.getByRole('button', { name })).toBeDisabled();
      await expect(page.getByRole('link', { name })).toHaveCount(0);
    }
    await expect(page.locator('.today-status')).toBeEmpty();
    await expect(main(page)).not.toContainText(/cihaz|sakla|depola/i);
    await expect(page.getByText(t.home.backupDue)).toHaveCount(0);
  });

  test('with reviews due: the dictionary size leads and the review count stays beneath the actions', async ({ page }) => {
    await open(page);
    await seedHome(page, dueWords(1284));
    await open(page);
    await expect(heading(page)).toHaveText(t.home.title);
    await expect(main(page)).toContainText(t.home.wordCount('1.284'));
    await expect(page.locator('.today-status')).toContainText(t.home.dueStatus('1.284'));
    await expect(main(page).locator('.btn-primary')).toHaveText(t.home.smartReview);
    await expect(main(page).getByRole('link', { name: t.home.freePractice })).toBeVisible();
    await expect(main(page).getByRole('link', { name: t.nav.import })).toBeVisible();
  });

  test('with nothing due: the same actions stay, the status says so and the backup reminder can go', async ({ page }) => {
    await open(page);
    await seedHome(page, { words: LIBRARY.words.slice(0, 1), cards: allScheduled(LIBRARY.words[0]!.id), meta: [{ key: 'lastBackupAt', value: Date.now() }] });
    await open(page);
    await expect(heading(page)).toHaveText(t.home.title);
    await expect(main(page)).toContainText(t.home.wordCount('1'));
    await expect(page.locator('.today-status')).toHaveText(t.home.doneStatus);
    await expect(main(page).locator('.btn-primary')).toHaveText(t.home.smartReview);
    await expect(page.getByText(t.home.backupDue)).toHaveCount(0);
  });

  test('the dictionary size counts each active word once, whatever its cards and collections', async ({ page }) => {
    await open(page);
    const [first, second, gone] = LIBRARY.words;
    const memberships = ['a', 'b'].flatMap((groupId) => [first!, second!].map((word) => ({ groupId, wordId: word.id, addedAt: 1 })));
    await seedHome(page, {
      words: [first!, second!, { ...gone!, deletedAt: 5 }],
      cards: allScheduled(first!.id),
      groups: ['a', 'b'].map((id, order) => ({ id, name: id, order, createdAt: 1, updatedAt: 1 })),
      groupMembers: memberships,
    });
    await open(page);
    await expect(main(page)).toContainText(t.home.wordCount('2'));
  });

  test('the secondary actions stay side by side on the narrowest phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page);
    await seedHome(page, { words: LIBRARY.words.slice(0, 1), meta: [{ key: 'lastBackupAt', value: Date.now() }] });
    await open(page);
    const tops = await main(page).locator('.today-secondary .btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect(tops).toHaveLength(2);
    expect(tops[0]).toBe(tops[1]);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
  });

  test('a due backup is one link to Settings', async ({ page }) => {
    await open(page);
    await seedHome(page, { words: LIBRARY.words.slice(0, 1) });
    await open(page);
    await page.getByRole('link', { name: t.home.backupDue }).click();
    await expect(heading(page)).toHaveText(t.settings.title);
  });

  for (const [width, height, rootPx] of [[320, 568, 16], [320, 568, 32], [390, 844, 32], [667, 375, 16], [820, 1100, 16], [1280, 800, 16], [2200, 1200, 16]] as const) {
    test(`every state fits at ${width}x${height}, ${rootPx}px text`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
      await open(page);
      const check = async (label: string) => {
        expect(await overflowing(page), label).toEqual([]);
        const action = (await main(page).locator('.btn-primary').boundingBox())!;
        expect(action.width, label).toBeLessThanOrEqual(rootPx * 22 + 1);
        for (const box of await main(page).locator('.today-actions .btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box, label).toBeGreaterThanOrEqual(44);
      };
      await check('empty');
      await seedHome(page, { words: LIBRARY.words.slice(0, 1) });
      await open(page);
      await check('ready to study');
      await seedHome(page, { cards: allScheduled(LIBRARY.words[0]!.id) });
      await open(page);
      await check('nothing due');
      await seedHome(page, dueWords(40));
      await open(page);
      await check('due');
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`every state has no detectable accessibility problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      const check = async (label: string) => {
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${label}: ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      };
      await check('empty');
      await seedHome(page, { words: LIBRARY.words.slice(0, 2) });
      await open(page);
      await check('ready to study, backup reminder');
      await seedHome(page, { words: LIBRARY.words.slice(0, 1), cards: allScheduled(LIBRARY.words[0]!.id) });
      await seedHome(page, dueWords(8));
      await open(page);
      await check('due');
    });
  }
});

test.describe('practice states', () => {
  const GALLERY = 'http://127.0.0.1:4174/e2e/gallery.html';

  for (const state of ['question', 'typing', 'article', 'correct', 'wrong', 'revealed', 'long']) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${state} in ${scheme} fits 320px and has no detectable problems`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`${GALLERY}?state=${state}`);
        await expect(page.locator('h1')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await overflowing(page)).toEqual([]);
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      });
    }
  }
});
