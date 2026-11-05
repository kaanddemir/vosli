import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const word = (id: string, lemma: string) => ({ id, identityKey: `${lemma}|der`, lemma, article: 'der', pos: 'noun', plural: null, meanings: [{ text: 'x', note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });
const group = (id: string, kind: string, name: string, order: number) => ({ id, kind, name, order, sourceId: null, createdAt: 1 });
const member = (groupId: string, wordId: string) => ({ groupId, wordId, addedAt: 1, importRowId: null });
const DAY = 86_400_000;
const card = { wordId: 'shared', track: 'de_tr', due: 2 * DAY, fsrs: { stability: 5, difficulty: 5, dueAt: 2 * DAY, lastReviewAt: DAY, state: 2, scheduleStatus: 'review', reps: 4, lapses: 0, scheduledDays: 5, learningStep: 0 }, schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1' };
const log = { id: 1, wordId: 'shared', track: 'de_tr', at: DAY };

const SEED = {
  words: [word('shared', 'Apfel'), word('only', 'Baum')],
  groups: [group('pdf', 'pdf', 'Dosya', 0), group('lesson', 'lesson', 'Ders Bir', 1), group('list', 'custom', 'Listem', 2)],
  groupMembers: [member('pdf', 'shared'), member('pdf', 'only'), member('lesson', 'shared')],
  cards: [card, { ...card, wordId: 'only' }],
  reviewLogs: [log, { ...log, id: 2, wordId: 'only' }],
};

const db = <T,>(page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('vosli');
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result as T[]);
          };
          request.onerror = () => reject(request.error);
        };
      }),
    table,
  );

test.beforeEach(async ({ page }) => {
  await page.goto('./#/collections');
  await expect(page.locator('h1')).toHaveText(t.collections.title);
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('vosli');
        open.onsuccess = () => {
          const tx = open.result.transaction(Object.keys(data), 'readwrite');
          for (const [name, rows] of Object.entries(data)) for (const row of rows) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    SEED,
  );
  await page.reload();
  await expect(page.getByRole('link', { name: /Dosya/ })).toBeVisible();
});

const main = (page: Page) => page.getByRole('main');
const enter = (page: Page) => main(page).getByRole('button', { name: t.common.select, exact: true }).click();
const box = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(name) });
const remove = (page: Page) => main(page).getByRole('button', { name: t.common.delete, exact: true });
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('header actions', () => {
  const actions = (page: Page) => main(page).locator('.header-buttons > *');
  const box = (locator: ReturnType<Page['locator']>) => locator.evaluate((el) => {
    const { top, left, right, bottom, width, height } = el.getBoundingClientRect();
    return { top, left, right, bottom, width, height };
  });
  const header = async (page: Page) => {
    const title = await page.locator('h1').evaluate((h1) => {
      const range = document.createRange();
      range.selectNodeContents(h1);
      const { top, bottom, left, right } = range.getBoundingClientRect();
      return { top, bottom, left, right, fontSize: getComputedStyle(h1).fontSize, fontWeight: getComputedStyle(h1).fontWeight };
    });
    const buttons = await actions(page).evaluateAll((items) => items.map((item) => {
      const { top, left, right, bottom, width, height } = item.getBoundingClientRect();
      return { top, left, right, bottom, width, height, radius: getComputedStyle(item).borderRadius };
    }));
    const edge = (await box(page.locator('.page-header'))).right;
    const next = (await box(page.locator('.screen > :nth-child(2)'))).top;
    return { title, buttons, edge, next };
  };

  for (const width of [320, 360, 375, 390, 430]) {
    test(`a phone ${width}px wide has one row, the same on Dictionary and Collections`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await expect(actions(page)).toHaveCount(3);
      const collections = await header(page);
      await main(page).getByRole('link', { name: t.nav.import }).click();
      await expect(page.locator('h1')).toHaveText(t.import.title);
      await page.goto('./#/dictionary');
      // Direction, hide answers, Seç and add.
      await expect(actions(page)).toHaveCount(4);
      const dictionary = await header(page);

      for (const { title, buttons, edge } of [collections, dictionary]) {
        expect(buttons.every((button) => button.top === buttons[0]!.top && button.height === buttons[0]!.height)).toBe(true);
        expect(buttons.every((button) => button.top < title.bottom && button.bottom > title.top)).toBe(true);
        expect(buttons.at(-1)!.right).toBeCloseTo(edge, 0);
        expect(title.right).toBeLessThanOrEqual(buttons[0]!.left);
      }
      expect(collections.title.fontSize).toBe(dictionary.title.fontSize);
      expect(collections.title.fontWeight).toBe(dictionary.title.fontWeight);
      expect(collections.title.top).toBe(dictionary.title.top);
      expect(collections.title.left).toBe(dictionary.title.left);
      expect(collections.buttons[0]!.top).toBe(dictionary.buttons[0]!.top);
      expect(collections.buttons[0]!.height).toBe(dictionary.buttons[0]!.height);
      expect(collections.buttons[0]!.radius).toBe(dictionary.buttons[0]!.radius);
      expect(collections.next).toBe(dictionary.next);
      expect(collections.buttons.every((button) => button.width >= 40 && button.height >= 44)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
  }

  for (const [width, collapsed] of [[768, false], [820, false], [1024, false], [768, true], [820, true]] as const) {
    test(`a tablet ${width}px wide with the sidebar ${collapsed ? 'collapsed' : 'open'} keeps one row on both screens`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      if (collapsed) {
        await page.getByRole('button', { name: t.collapseMenu }).click();
        await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
      }
      for (const [route, count] of [['collections', 3], ['dictionary', 4]] as const) {
        await page.goto(`./#/${route}`);
        await expect(actions(page)).toHaveCount(count);
        await expect.poll(async () => {
          const { title, buttons } = await header(page);
          return buttons.every((button) => button.top < title.bottom && button.bottom > title.top && title.right <= button.left);
        }).toBe(true);
      }
    });
  }

  test('on a phone every action keeps its name, and selecting works the same', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await expect(main(page).getByRole('link', { name: t.nav.import }).locator('.btn-label')).toBeHidden();
    await expect(main(page).getByRole('button', { name: t.collections.create, exact: true }).locator('.btn-label')).toBeHidden();
    const select = main(page).getByRole('button', { name: t.common.select, exact: true });
    await expect(select.locator('.icon')).toBeVisible();
    // Every icon sits in the middle of its button, with room to show.
    const offsets = await actions(page).evaluateAll((items) => items.map((item) => {
      const button = item.getBoundingClientRect();
      const icon = item.querySelector('.icon')!.getBoundingClientRect();
      return { x: Math.abs(button.left + button.width / 2 - (icon.left + icon.width / 2)), size: icon.width };
    }));
    expect(offsets.every(({ x, size }) => x < 1 && size >= 16)).toBe(true);
    await select.click();
    await expect(actions(page)).toHaveText([t.common.cancel]);
    await expect(actions(page).locator('.btn-label')).toBeVisible();
    await box(page.getByRole('checkbox').first());
    await main(page).getByRole('button', { name: t.common.cancel, exact: true }).click();
    await expect(actions(page)).toHaveCount(3);
    await main(page).getByRole('button', { name: t.collections.create, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('much larger text wraps rather than clipping or shrinking', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.evaluate(() => (document.documentElement.style.fontSize = '24px'));
    const { title, buttons } = await header(page);
    expect(parseFloat(await page.locator('h1').evaluate((h1) => getComputedStyle(h1).fontSize))).toBeGreaterThanOrEqual(24 * 2 * 0.75 - 0.01);
    expect(buttons[0]!.top).toBeGreaterThanOrEqual(title.bottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });

  test('a wide window keeps the labels and shows no select mark', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(actions(page).locator('.btn-label')).toHaveText([t.common.select, t.collections.create, t.nav.import]);
    await expect(actions(page).first().locator('.icon')).toBeHidden();
    const dictionaryTop = (await header(page)).title.top;
    await page.goto('./#/dictionary');
    await expect(actions(page)).toHaveCount(4);
    expect((await header(page)).title.top).toBe(dictionaryTop);
  });
});

test('Seç sits just before create, and becomes Vazgeç with focus kept', async ({ page }) => {
  await expect(main(page).locator('.header-buttons > *')).toHaveText([t.common.select, t.collections.create, t.nav.import]);
  await enter(page);
  const cancel = main(page).getByRole('button', { name: t.common.cancel, exact: true });
  await expect(cancel).toBeFocused();
  await expect(remove(page)).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText(t.common.selected('0'));
  await cancel.click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Dosya/ })).toBeVisible();
});

test('one, then several across sections, by mouse and keyboard', async ({ page }) => {
  await enter(page);
  await box(page, 'Dosya').click();
  await expect(page.getByRole('status')).toHaveText(t.common.selected('1'));
  await box(page, 'Listem').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('status')).toHaveText(t.common.selected('2'));
  await box(page, 'Dosya').click();
  await expect(page.getByRole('status')).toHaveText(t.common.selected('1'));
  await expect(box(page, 'Listem')).toBeChecked();
});

test('select all turns into clear', async ({ page }) => {
  await enter(page);
  await main(page).getByRole('button', { name: t.common.selectAll }).click();
  await expect(page.getByRole('status')).toHaveText(t.common.selected('3'));
  await main(page).getByRole('button', { name: t.common.clearSelection }).click();
  await expect(page.getByRole('status')).toHaveText(t.common.selected('0'));
});

test('cancelling the confirmation deletes nothing and keeps the selection', async ({ page }) => {
  await enter(page);
  await box(page, 'Dosya').click();
  await remove(page).click();
  await expect(dialog(page)).toContainText(t.collections.bulkDeleteTitle('1'));
  await expect(dialog(page)).toContainText(t.collections.deleteOnlyDetail);
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await dialog(page).getByRole('button', { name: t.common.cancel }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(box(page, 'Dosya')).toBeChecked();
  expect(await db(page, 'groups')).toHaveLength(3);
});

test('deleting a collection keeps its words, cards, history and the other collection sharing a word', async ({ page }) => {
  await enter(page);
  await box(page, 'Dosya').click();
  await remove(page).click();
  await dialog(page).getByRole('button', { name: t.common.delete }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Dosya/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Ders Bir/ })).toContainText('1');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: t.common.select, exact: true })).toBeVisible();

  expect(await db(page, 'words')).toHaveLength(2);
  expect(await db(page, 'cards')).toHaveLength(2);
  expect(await db(page, 'reviewLogs')).toHaveLength(2);
  expect(await db(page, 'groupMembers')).toEqual([member('lesson', 'shared')]);
});

test('deleting every collection leads to the empty state', async ({ page }) => {
  await enter(page);
  await main(page).getByRole('button', { name: t.common.selectAll }).click();
  await remove(page).click();
  await expect(dialog(page)).toContainText(t.collections.bulkDeleteTitle('3'));
  await dialog(page).getByRole('button', { name: t.common.delete }).click();
  await expect(page.getByText(t.collections.emptyTitle)).toBeVisible();
  expect(await db(page, 'groupMembers')).toEqual([]);
  expect(await db(page, 'words')).toHaveLength(2);
});

test('a failed delete changes nothing, even after earlier collections in the batch', async ({ page }) => {
  await enter(page);
  await box(page, 'Dosya').click();
  await box(page, 'Listem').click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function failing(key: IDBValidKey | IDBKeyRange) {
      if (key === 'list') throw new DOMException('blocked', 'UnknownError');
      return original.call(this, key);
    };
  });
  await remove(page).click();
  await dialog(page).getByRole('button', { name: t.common.delete }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText(t.collections.deleteFailed);
  expect(await db(page, 'groups')).toHaveLength(3);
  expect(await db(page, 'groupMembers')).toHaveLength(3);
  await dialog(page).getByRole('button', { name: t.common.cancel }).click();
  await expect(box(page, 'Dosya')).toBeChecked();
});

test('selection mode has no accessibility problems, in either theme', async ({ page }) => {
  await enter(page);
  await box(page, 'Dosya').click();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await enter(page);
    await box(page, 'Dosya').click();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  }
});

for (const width of [320, 390]) {
  test(`the toolbar fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await enter(page);
    await box(page, 'Dosya').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await expect(remove(page)).toBeInViewport();
    const height = (await remove(page).boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(44);
  });
}

test.describe('deleting words too', () => {
  const choose = (page: Page) => dialog(page).getByRole('radio', { name: new RegExp(t.collections.deleteWithWords) });
  const ids = async (page: Page, table: string, key = 'id') => (await db<Record<string, string>>(page, table)).map((row) => row[key]).sort();

  test('keeping the words is the default, and the counts and the warning are shown before anything happens', async ({ page }) => {
    await enter(page);
    await box(page, 'Dosya').click();
    await remove(page).click();
    await expect(dialog(page).getByRole('radio', { name: new RegExp(t.collections.deleteOnlyCollections) })).toBeChecked();
    await expect(dialog(page).getByRole('button', { name: t.common.delete, exact: true })).toBeVisible();
    await expect(dialog(page).getByText(t.collections.deleteForever)).toHaveCount(0);
    await expect(dialog(page).getByTestId('delete-counts')).toHaveText(t.collections.deleteWithWordsDetail('1'));
    await expect(dialog(page).getByTestId('delete-shared')).toHaveText(t.collections.deleteShared('1'));
    await choose(page).check();
    await expect(dialog(page).getByText(t.collections.deleteForever)).toBeVisible();
    expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
    await dialog(page).getByRole('button', { name: t.common.cancel }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await ids(page, 'words')).toEqual(['only', 'shared']);
    expect(await db(page, 'groups')).toHaveLength(3);
  });

  test('removes own words with their cards and history, and keeps a word another collection holds', async ({ page }) => {
    await enter(page);
    await box(page, 'Dosya').click();
    await remove(page).click();
    await choose(page).check();
    await dialog(page).getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Dosya/ })).toHaveCount(0);
    expect(await ids(page, 'words')).toEqual(['shared']);
    expect(await ids(page, 'cards', 'wordId')).toEqual(['shared']);
    expect(await ids(page, 'reviewLogs', 'wordId')).toEqual(['shared']);
    expect(await db(page, 'groupMembers')).toEqual([member('lesson', 'shared')]);
  });

  test('a word held only by the selected collections goes, across several of them', async ({ page }) => {
    await enter(page);
    await box(page, 'Dosya').click();
    await box(page, 'Ders Bir').click();
    await remove(page).click();
    await expect(dialog(page).getByTestId('delete-counts')).toHaveText(t.collections.deleteWithWordsDetail('2'));
    await expect(dialog(page).getByTestId('delete-shared')).toHaveCount(0);
    await choose(page).check();
    await dialog(page).getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await ids(page, 'words')).toEqual([]);
    expect(await ids(page, 'groups')).toEqual(['list']);
  });

  test('on a small screen both buttons stay in view while the choices scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await enter(page);
    await box(page, 'Dosya').click();
    await remove(page).click();
    await choose(page).check();
    await expect(dialog(page).getByRole('button', { name: t.common.cancel })).toBeInViewport({ ratio: 1 });
    await expect(dialog(page).getByRole('button', { name: t.collections.deleteForeverConfirm })).toBeInViewport({ ratio: 1 });
    const warning = dialog(page).getByText(t.collections.deleteForever);
    await expect(warning).toBeInViewport({ ratio: 1 });
    const buttons = (await dialog(page).locator('.btn-row').boundingBox())!;
    const text = (await warning.boundingBox())!;
    expect(text.y + text.height).toBeLessThanOrEqual(buttons.y + 1);
    const covered = await dialog(page).getByRole('button', { name: t.common.cancel }).evaluate((button) => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
    expect(covered).toBe(true);
  });

  test('a collection with no words of its own cannot delete any', async ({ page }) => {
    await enter(page);
    await box(page, 'Listem').click();
    await remove(page).click();
    await expect(choose(page)).toBeDisabled();
    await expect(dialog(page).getByTestId('delete-counts')).toHaveText(t.collections.deleteNoOwnWords);
  });

  test('the same choice on a collection page', async ({ page }) => {
    await page.goto('./#/collections/pdf');
    await page.getByRole('button', { name: t.collections.deleteCollection }).click();
    await expect(dialog(page).getByTestId('delete-shared')).toHaveText(t.collections.deleteShared('1'));
    await choose(page).check();
    await dialog(page).getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
    await expect(page.locator('h1')).toHaveText(t.collections.title);
    expect(await ids(page, 'words')).toEqual(['shared']);
  });

  test('a failure leaves words, cards, history and collections as they were', async ({ page }) => {
    await enter(page);
    await box(page, 'Dosya').click();
    await remove(page).click();
    await choose(page).check();
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function failing(key: IDBValidKey | IDBKeyRange) {
        if (key === 'pdf') throw new DOMException('blocked', 'UnknownError');
        return original.call(this, key);
      };
    });
    await dialog(page).getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
    await expect(dialog(page).getByRole('alert')).toHaveText(t.collections.deleteFailed);
    expect(await ids(page, 'words')).toEqual(['only', 'shared']);
    expect(await db(page, 'cards')).toHaveLength(2);
    expect(await db(page, 'reviewLogs')).toHaveLength(2);
    expect(await db(page, 'groupMembers')).toHaveLength(3);
    expect(await db(page, 'groups')).toHaveLength(3);
  });
});
