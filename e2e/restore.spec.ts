import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { t } from '../src/i18n/strings';

/** Restoring a backup: what the learner sees before anything changes, and that a restore replaces everything. */

const EXPORTED_AT = Date.UTC(2026, 10, 1, 12);
const word = (id: string, lemma: string, article: string | null, meaning: string, language?: 'de' | 'en') => ({
  id,
  ...(language ? { language } : {}),
  identityKey: `${lemma}|${article ?? ''}`,
  lemma,
  article,
  pos: article ? 'noun' : 'other',
  plural: null,
  meanings: [{ text: meaning, note: null }],
  senseTag: null,
  searchTokens: [lemma.toLowerCase()],
  favoritedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
const tables = (overrides: Record<string, Record<string, unknown>[]>) => ({ words: [], cards: [], reviewLogs: [], groups: [], groupMembers: [], sources: [], importRows: [], meta: [], ...overrides });
const file = (backup: unknown, name = 'vosli-backup.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });

/** Three English words and nothing German, as a later version that can study English would save it. */
const englishOnly = {
  app: 'vosli',
  backupVersion: 1,
  schemaVersion: 2,
  exportedAt: EXPORTED_AT,
  tables: tables({
    words: [word('en-apple', 'apple', null, 'elma', 'en'), word('en-pear', 'pear', null, 'armut', 'en'), word('en-also', 'also', null, 'ayrıca', 'en')],
    groups: [{ id: 'g-en', language: 'en', kind: 'custom', name: 'Fruit', order: 0, sourceId: null, createdAt: 1 }],
    meta: [
      { key: 'schemaVersion', value: 2 },
      { key: 'learningLanguage', value: 'en' },
      { key: 'onboarding', value: { via: 'welcome', at: 5 } },
    ],
  }),
};

/** A German backup as the app saved them before learning languages: no language anywhere, schema version 1. */
const legacy = {
  app: 'vosli',
  backupVersion: 1,
  schemaVersion: 1,
  exportedAt: EXPORTED_AT,
  tables: tables({ words: [word('w-hund', 'Hund', 'der', 'köpek'), word('w-katze', 'Katze', 'die', 'kedi')], meta: [{ key: 'schemaVersion', value: 1 }] }),
};

async function inDb<T>(page: Page, run: string): Promise<T> {
  return page.evaluate(
    (source) =>
      new Promise<T>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          (new Function('db', `return (${source})(db)`) as (db: IDBDatabase) => Promise<T>)(db).then((value) => {
            db.close();
            resolve(value);
          }, reject);
        };
      }),
    run,
  );
}

const all = (page: Page, table: string) =>
  inDb<Record<string, unknown>[]>(page, `(db) => new Promise((ok, no) => { const r = db.transaction('${table}').objectStore('${table}').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); })`);
const metaValue = async (page: Page, key: string) => (await all(page, 'meta')).find((row) => row.key === key)?.value;

/** Five German words on the device, in the German workspace as Phase 2A keeps everyone. */
async function seeded(page: Page) {
  await page.goto('./#/settings');
  await expect(page.locator('h1')).toHaveText(t.settings.title);
  const words = [word('d1', 'Apfel', 'der', 'elma'), word('d2', 'Birne', 'die', 'armut'), word('d3', 'Haus', 'das', 'ev'), word('d4', 'gehen', null, 'gitmek'), word('d5', 'schön', null, 'güzel')];
  await page.evaluate(
    (rows) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['words'], 'readwrite');
          for (const row of rows) tx.objectStore('words').put(Object.assign({ language: 'de' }, row));
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    words,
  );
  await page.reload();
  await expect(page.locator('h1')).toHaveText(t.settings.title);
}

const choose = (page: Page, backup: unknown) => page.locator('input[type=file]').setInputFiles(file(backup));
const dialog = (page: Page) => page.getByRole('dialog', { name: t.restore.title });
const rows = (page: Page) => dialog(page).getByTestId('restore-compare').locator('tbody tr');

test('compares the device with the backup, names a language that would be emptied, and cancelling changes nothing', async ({ page }) => {
  await seeded(page);
  await choose(page, englishOnly);
  await expect(dialog(page)).toBeVisible();
  await expect(rows(page)).toHaveText([
    `${t.restore.germanWords}50`,
    `${t.restore.englishWords}03`,
    `${t.restore.groups}01`,
    `${t.restore.logs}00`,
  ]);
  await expect(dialog(page).getByRole('columnheader')).toHaveText([t.restore.data, t.restore.current, t.restore.backup]);
  await expect(dialog(page)).toContainText(t.restore.replaces);
  await expect(dialog(page).getByTestId('restore-removed')).toHaveText(t.restore.removed(5, 'de'));
  await expect(dialog(page).getByTestId('restore-continue')).toHaveText(t.lang.en.continueIn);
  await expect(dialog(page)).toContainText(t.restore.safetyCopy);
  // Cancel holds the focus, so Enter never replaces anything by accident.
  await expect(dialog(page).getByRole('button', { name: t.common.cancel })).toBeFocused();
  await expect(dialog(page).getByRole('button', { name: t.restore.confirm })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);

  await dialog(page).getByRole('button', { name: t.common.cancel }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await all(page, 'words')).map((row) => row.id).sort()).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
  expect(await metaValue(page, 'learningLanguage')).toBe('de');
  expect(await metaValue(page, 'onboarding')).toMatchObject({ via: 'legacy' });
});

test('says nothing about a language the backup keeps', async ({ page }) => {
  await seeded(page);
  await choose(page, legacy);
  await expect(rows(page).first()).toHaveText(`${t.restore.germanWords}52`);
  await expect(dialog(page).getByTestId('restore-removed')).toHaveCount(0);
});

test('a damaged file is refused before any dialog, and nothing changes', async ({ page }) => {
  await seeded(page);
  const broken = structuredClone(englishOnly) as { tables: { words: Record<string, unknown>[] } };
  broken.tables.words[0]!.language = 'fr';
  await choose(page, broken);
  await expect(page.getByRole('status').filter({ hasText: t.restore.rejected })).toContainText(t.restore.errors.invalid_language);
  await expect(dialog(page)).toHaveCount(0);
  expect(await all(page, 'words')).toHaveLength(5);
});

test('confirming downloads a copy first, replaces everything, and starts over on Home with a notice, in every tab', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'Downloads differ on mobile emulation; covered on desktop and by unit tests');
  await seeded(page);
  await page.evaluate(() => {
    localStorage.setItem('vosli.locale', 'en');
    sessionStorage.setItem('vosli.test-session', '{}');
    sessionStorage.setItem('vosli.review-session', '{}');
  });
  const other = await context.newPage();
  await other.goto('./#/dictionary');
  await expect(other.locator('h1')).toHaveText(t.nav.dictionary);
  await other.evaluate(() => sessionStorage.setItem('vosli.practice-session', '{}'));
  const otherReloaded = other.waitForEvent('load');

  await choose(page, englishOnly);
  const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: t.restore.confirm }).click()]);
  expect(download.suggestedFilename()).toMatch(/^vosli-backup-.*\.json$/);

  await expect(page.getByRole('status').filter({ hasText: t.restore.done })).toBeVisible();
  // The backup chose English; Settings' question before a switch is not asked again.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: t.lang.en.switchTitle })).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('#/');
  expect(await page.evaluate(() => [sessionStorage.getItem('vosli.test-session'), sessionStorage.getItem('vosli.review-session'), localStorage.getItem('vosli.locale')])).toEqual([null, null, 'en']);

  expect((await all(page, 'words')).map((row) => [row.id, row.language]).sort()).toEqual([['en-also', 'en'], ['en-apple', 'en'], ['en-pear', 'en']]);
  expect(await metaValue(page, 'learningLanguage')).toBe('en');
  expect(await metaValue(page, 'onboarding')).toEqual({ via: 'welcome', at: 5 });
  expect(await metaValue(page, 'lastBackupAt')).toBe(EXPORTED_AT);

  await otherReloaded;
  expect(await other.evaluate(() => sessionStorage.getItem('vosli.practice-session'))).toBeNull();

  // The backup's workspace opens, with its words there to study, and German is empty as the backup was.
  await expect(page.getByTestId('home-workspace')).toHaveText(t.home.workspace(3));
  await page.goto('./#/dictionary');
  await expect(page.getByRole('link', { name: /apple/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /pear/ })).toBeVisible();
});

test('an old German backup comes back as German, ready to study', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Downloads differ on mobile emulation; covered on desktop and by unit tests');
  await seeded(page);
  await choose(page, legacy);
  await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: t.restore.confirm }).click()]);
  await expect(page.getByRole('status').filter({ hasText: t.restore.done })).toBeVisible();
  expect((await all(page, 'words')).map((row) => [row.id, row.language]).sort()).toEqual([['w-hund', 'de'], ['w-katze', 'de']]);
  expect(await metaValue(page, 'learningLanguage')).toBe('de');
  expect(await metaValue(page, 'onboarding')).toEqual({ via: 'restore', at: EXPORTED_AT });
  await page.goto('./#/dictionary');
  await expect(page.getByRole('link', { name: /Hund/ })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`fits at 320px with 200% text and passes accessibility checks, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await seeded(page);
    await page.evaluate((value) => localStorage.setItem('vosli.theme', value), theme);
    await page.reload();
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    await choose(page, englishOnly);
    await expect(dialog(page)).toBeVisible();
    const box = (await dialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    // Nothing is cut off sideways: the table and its numbers stay inside the dialog.
    expect(await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const confirm = dialog(page).getByRole('button', { name: t.restore.confirm });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  });
}
