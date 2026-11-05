import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const word = { id: 'apfel', identityKey: 'Apfel|der', lemma: 'Apfel', article: 'der', pos: 'noun', plural: null, meanings: [{ text: 'elma', note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null };
const group = { id: 'g1', name: 'Liste', createdAt: 1, updatedAt: 1 };

const inDb = <T,>(page: Page, body: string) =>
  page.evaluate(
    (source) =>
      new Promise<T>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const run = new Function('db', `return (${source})(db)`) as (db: IDBDatabase) => Promise<T>;
          run(db).then((value) => {
            db.close();
            resolve(value);
          }, reject);
        };
      }),
    body,
  );

async function seed(page: Page) {
  await page.goto('./#/settings');
  await expect(page.locator('h1')).toHaveText(t.settings.title);
  await page.evaluate(
    ([w, g]) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['words', 'groups'], 'readwrite');
          tx.objectStore('words').put(w);
          tx.objectStore('groups').put(g);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [word, group],
  );
  await page.evaluate(() => {
    localStorage.setItem('vosli.theme', 'dark');
    localStorage.setItem('vosli.practice-settings', '{}');
    localStorage.setItem('other-app.key', 'keep');
    sessionStorage.setItem('vosli.review-session', '{}');
    sessionStorage.setItem('other-app.session', 'keep');
  });
  await page.reload();
  await expect(page.locator('h1')).toHaveText(t.settings.title);
}

const count = (page: Page, table: string) =>
  inDb<number>(page, `(db) => new Promise((ok, no) => { const r = db.transaction('${table}').objectStore('${table}').count(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); })`);

const openDialog = async (page: Page) => {
  await page.getByRole('button', { name: t.settings.reset }).click();
  return page.getByRole('dialog', { name: t.settings.resetTitle });
};

test('the section sits between backup and sources', async ({ page }) => {
  await page.goto('./#/settings');
  await expect(page.locator('.list-label')).toHaveText([t.settings.appearance, t.settings.backup, t.settings.dataManagement, t.settings.sources]);
});

test('cancelling changes nothing and returns focus', async ({ page }) => {
  await seed(page);
  const dialog = await openDialog(page);
  await expect(dialog).toContainText(t.settings.resetBody);
  await expect(dialog.getByRole('button', { name: t.common.cancel })).toBeFocused();
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: t.common.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.settings.reset })).toBeFocused();
  expect(await count(page, 'words')).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('vosli.theme'))).toBe('dark');
});

test('confirming clears only Vosli data and lands on the empty Home with defaults', { tag: '@smoke' }, async ({ page }) => {
  await seed(page);
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: t.settings.resetConfirm }).click();

  await expect(page.locator('.today-support')).toHaveText(t.home.emptySupport);
  await expect(page.getByRole('status').filter({ hasText: t.settings.resetDone })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/');
  for (const table of ['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows']) expect(await count(page, table)).toBe(0);

  const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), other: localStorage.getItem('other-app.key'), otherSession: sessionStorage.getItem('other-app.session') }));
  expect(stored.local.filter((key) => key.startsWith('vosli.'))).toEqual([]);
  expect(stored.session.filter((key) => key.startsWith('vosli.'))).toEqual([]);
  expect(stored.other).toBe('keep');
  expect(stored.otherSession).toBe('keep');

  await page.goto('./#/dictionary');
  await expect(page.getByText(t.dictionary.emptyTitle)).toBeVisible();
  await page.goto('./#/settings');
  await expect(page.getByRole('radio', { name: t.settings.themes.system })).toBeChecked();
  await expect(page.getByTestId('last-backup')).toHaveText(t.settings.never);
});

test('the notice shows once', async ({ page }) => {
  await seed(page);
  await (await openDialog(page)).getByRole('button', { name: t.settings.resetConfirm }).click();
  await expect(page.getByText(t.settings.resetDone)).toBeVisible();
  await page.reload();
  await expect(page.locator('.today-support')).toHaveText(t.home.emptySupport);
  await expect(page.getByText(t.settings.resetDone)).toHaveCount(0);
});

test('a database failure keeps everything and says so', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    IDBObjectStore.prototype.clear = function failing() {
      throw new DOMException('blocked', 'UnknownError');
    };
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: t.settings.resetConfirm }).click();
  await expect(dialog.getByRole('alert')).toHaveText(t.settings.resetFailed);
  await expect(dialog.getByRole('button', { name: t.common.cancel })).toBeEnabled();
  expect(await count(page, 'words')).toBe(1);
  expect(await count(page, 'groups')).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('vosli.theme'))).toBe('dark');
  await expect(page.locator('h1')).toHaveText(t.settings.title);
});

test('settings that cannot be cleared are reported, not hidden', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function failing(key: string) {
      if (key === 'vosli.theme') throw new DOMException('blocked', 'SecurityError');
      original.call(this, key);
    };
  });
  await (await openDialog(page)).getByRole('button', { name: t.settings.resetConfirm }).click();
  await expect(page.locator('.today-support')).toHaveText(t.home.emptySupport);
  await expect(page.getByText(t.settings.resetPartial)).toBeVisible();
  expect(await count(page, 'words')).toBe(0);
});

test('another open tab starts over too', async ({ page, context }) => {
  await seed(page);
  const other = await context.newPage();
  await other.goto('./#/dictionary');
  await expect(other.getByText('Apfel').first()).toBeVisible();
  await (await openDialog(page)).getByRole('button', { name: t.settings.resetConfirm }).click();
  await expect(page.locator('.today-support')).toHaveText(t.home.emptySupport);
  await expect(other.getByText(t.dictionary.emptyTitle)).toBeVisible();
});
