import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const word = (id: string, lemma: string, meaning: string, favorite = false) => ({ id, identityKey: `${lemma}|`, lemma, article: null, pos: 'other', plural: null, meanings: [{ text: meaning, note: null }], senseTag: null, searchTokens: [], favoritedAt: favorite ? 1 : null, createdAt: 1, updatedAt: 1, deletedAt: null });
const DAY = 86_400_000;
const card = (wordId: string) => ({ wordId, track: 'de_tr', due: 2 * DAY, fsrs: { stability: 5, difficulty: 5, dueAt: 2 * DAY, lastReviewAt: DAY, state: 2, scheduleStatus: 'review', reps: 4, lapses: 0, scheduledDays: 5, learningStep: 0 }, schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1' });
const member = (groupId: string, wordId: string) => ({ groupId, wordId, addedAt: 1, importRowId: null });

const SEED = {
  words: [word('apfel', 'Apfel', 'elma', true), word('baum', 'Baum', 'ağaç'), word('haus', 'Haus', 'ev', true), word('tisch', 'Tisch', 'masa')],
  cards: [card('apfel'), card('baum')],
  reviewLogs: [{ id: 1, wordId: 'apfel', track: 'de_tr', at: DAY }, { id: 2, wordId: 'baum', track: 'de_tr', at: DAY }],
  groups: [{ id: 'g1', kind: 'pdf', name: 'Dosya', order: 0, sourceId: 's1', createdAt: 1 }, { id: 'g2', kind: 'custom', name: 'Listem', order: 1, sourceId: null, createdAt: 1 }],
  groupMembers: [member('g1', 'apfel'), member('g2', 'apfel'), member('g1', 'baum')],
  sources: [{ id: 's1', fileName: 'ders.pdf', fileHash: 'h', importedAt: 1, pipelineVersion: 1 }],
};

const put = (page: Page, data: Record<string, unknown[]>) =>
  page.evaluate(
    (tables) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('vosli');
        open.onsuccess = () => {
          const tx = open.result.transaction(Object.keys(tables), 'readwrite');
          for (const [name, rows] of Object.entries(tables)) for (const row of rows) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    data,
  );

const read = <T = Record<string, string>,>(page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<T[]>((resolve) => {
        const open = indexedDB.open('vosli');
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result as T[]);
          };
        };
      }),
    table,
  );

const ids = async (page: Page, table: string, key = 'id') => (await read(page, table)).map((row) => row[key]).sort();

const main = (page: Page) => page.getByRole('main');
const enter = (page: Page) => main(page).getByRole('button', { name: t.common.select, exact: true }).click();
const box = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(name) });
const count = (page: Page) => main(page).locator('.selection-count');
const toggleAll = (page: Page, name: string) => main(page).getByRole('button', { name }).click();
const remove = (page: Page) => main(page).getByRole('button', { name: t.common.delete, exact: true });
const dialog = (page: Page) => page.getByRole('dialog');
const confirm = (page: Page) => dialog(page).getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
const search = (page: Page, text: string) => page.getByLabel(t.dictionary.searchLabel).fill(text);
const favorites = (page: Page) => page.locator('.segmented label').filter({ hasText: t.dictionary.filterFavorites }).click();

test.beforeEach(async ({ page }) => {
  await page.goto('./#/dictionary');
  await expect(page.locator('h1')).toHaveText(t.dictionary.title);
  await put(page, SEED);
  await page.reload();
  await expect(page.getByRole('link', { name: /Apfel/ })).toBeVisible();
});

test('Seç sits just before add, and becomes Vazgeç with focus kept', async ({ page }) => {
  const names = await main(page).locator('.header-buttons > *').evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? element.textContent));
  expect(names).toEqual([t.dictionary.direction, t.dictionary.hideAnswers, t.common.select, t.dictionary.addWord]);
  await enter(page);
  const cancel = main(page).getByRole('button', { name: t.common.cancel, exact: true });
  await expect(cancel).toBeFocused();
  await expect(remove(page)).toBeDisabled();
  await expect(count(page)).toHaveText(t.common.selected('0'));
  await cancel.click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Apfel/ })).toBeVisible();
});

test('one, then several, by mouse and keyboard', async ({ page }) => {
  await enter(page);
  await box(page, 'Apfel').click();
  await expect(count(page)).toHaveText(t.common.selected('1'));
  await box(page, 'Baum').focus();
  await page.keyboard.press('Space');
  await expect(count(page)).toHaveText(t.common.selected('2'));
  await box(page, 'Apfel').click();
  await expect(count(page)).toHaveText(t.common.selected('1'));
});

test('select all takes every result, including rows not yet on the page', async ({ page }) => {
  await put(page, { words: Array.from({ length: 130 }, (_, i) => word(`w${i}`, `Wort${i}`, `kelime${i}`)) });
  await page.reload();
  await enter(page);
  await expect(page.getByRole('checkbox')).toHaveCount(100);
  await toggleAll(page, t.common.selectAll);
  await expect(count(page)).toHaveText(t.common.selected('134'));
  await toggleAll(page, t.common.clearSelection);
  await expect(count(page)).toHaveText(t.common.selected('0'));
});

test('select all follows the search, and clearing removes only what is shown', async ({ page }) => {
  await enter(page);
  await box(page, 'Tisch').click();
  // Finds Apfel (elma) and Haus (ev), not Tisch.
  await search(page, 'e');
  await expect(box(page, 'Haus')).toBeVisible();
  await expect(box(page, 'Tisch')).toHaveCount(0);
  const shown = await page.getByRole('checkbox').count();
  await toggleAll(page, t.common.selectAll);
  const inSearch = await page.getByRole('checkbox', { checked: true }).count();
  expect(inSearch).toBe(shown);
  await toggleAll(page, t.common.clearSelection);
  await search(page, '');
  await expect(box(page, 'Tisch')).toBeChecked();
});

test('select all follows the Favoriler filter', async ({ page }) => {
  await enter(page);
  await favorites(page);
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await toggleAll(page, t.common.selectAll);
  await expect(count(page)).toHaveText(t.common.selected('2'));
  await remove(page).click();
  await expect(dialog(page)).toContainText(t.dictionary.bulkDeleteTitle('2'));
  await expect(dialog(page).getByTestId('delete-hidden')).toHaveCount(0);
  await confirm(page);
  await expect(page.getByText(t.dictionary.noFavorites)).toBeVisible();
  expect(await ids(page, 'words')).toEqual(['baum', 'tisch']);
});

test('the dialog says when chosen words are out of sight', async ({ page }) => {
  await enter(page);
  await box(page, 'Tisch').click();
  await box(page, 'Apfel').click();
  await search(page, 'Apfel');
  await remove(page).click();
  await expect(dialog(page)).toContainText(t.dictionary.bulkDeleteTitle('2'));
  await expect(dialog(page).getByTestId('delete-hidden')).toHaveText(t.dictionary.bulkDeleteHidden('1'));
});

test('cancelling deletes nothing and keeps the selection', async ({ page }) => {
  await enter(page);
  await box(page, 'Apfel').click();
  await remove(page).click();
  await expect(dialog(page)).toContainText(t.dictionary.bulkDeleteBody);
  await expect(dialog(page).getByRole('button', { name: t.common.cancel })).toBeFocused();
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await dialog(page).getByRole('button', { name: t.common.cancel }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(box(page, 'Apfel')).toBeChecked();
  expect(await ids(page, 'words')).toEqual(['apfel', 'baum', 'haus', 'tisch']);
});

test('confirming removes the words with everything of theirs, from every collection, and nothing else', async ({ page }) => {
  await enter(page);
  await box(page, 'Apfel').click();
  await remove(page).click();
  await expect(dialog(page)).toContainText(t.dictionary.bulkDeleteTitle('1'));
  await confirm(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Apfel/ })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: t.common.select, exact: true })).toBeFocused();
  expect(await ids(page, 'words')).toEqual(['baum', 'haus', 'tisch']);
  expect(await ids(page, 'cards', 'wordId')).toEqual(['baum']);
  expect(await ids(page, 'reviewLogs', 'wordId')).toEqual(['baum']);
  expect(await ids(page, 'groupMembers', 'wordId')).toEqual(['baum']);
  expect(await ids(page, 'groups')).toEqual(['g1', 'g2']);
  expect(await ids(page, 'sources')).toEqual(['s1']);

  await page.goto('./#/collections');
  await expect(page.getByRole('link', { name: /Listem/ })).toContainText('0');
  await expect(page.getByRole('link', { name: /Dosya/ })).toContainText('1');
  await page.goto('./#/');
  await expect(page.locator('.today-support')).not.toHaveText(t.home.emptySupport);
});

test('deleting every word leads to the empty state and an empty Home', async ({ page }) => {
  await enter(page);
  await toggleAll(page, t.common.selectAll);
  await remove(page).click();
  await confirm(page);
  await expect(page.getByText(t.dictionary.emptyTitle)).toBeVisible();
  await page.goto('./#/');
  await expect(page.locator('.today-support')).toHaveText(t.home.emptySupport);
});

test('a failure changes nothing and says so', async ({ page }) => {
  await enter(page);
  await box(page, 'Apfel').click();
  await box(page, 'Haus').click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function failing(key: IDBValidKey | IDBKeyRange) {
      if (key === 'haus') throw new DOMException('blocked', 'UnknownError');
      return original.call(this, key);
    };
  });
  await remove(page).click();
  await confirm(page);
  await expect(dialog(page).getByRole('alert')).toHaveText(t.collections.deleteFailed);
  expect(await ids(page, 'words')).toEqual(['apfel', 'baum', 'haus', 'tisch']);
  expect(await ids(page, 'cards', 'wordId')).toEqual(['apfel', 'baum']);
  expect(await read(page, 'reviewLogs')).toHaveLength(2);
  expect(await read(page, 'groupMembers')).toHaveLength(3);
  await dialog(page).getByRole('button', { name: t.common.cancel }).click();
  await expect(box(page, 'Apfel')).toBeChecked();
});

test('selection mode has no accessibility problems, in either theme', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await enter(page);
    await box(page, 'Apfel').click();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  }
});

for (const width of [320, 390]) {
  test(`the toolbar fits at ${width}px and stays while the list scrolls`, async ({ page }) => {
    await put(page, { words: Array.from({ length: 40 }, (_, i) => word(`w${i}`, `Wort${i}`, `kelime${i}`)) });
    await page.setViewportSize({ width, height: 640 });
    await page.reload();
    await enter(page);
    await box(page, 'Apfel').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.evaluate(() => scrollTo(0, 900));
    await expect(remove(page)).toBeInViewport({ ratio: 1 });
    expect((await remove(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
}
