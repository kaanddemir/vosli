import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const DIST = join(process.cwd(), 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };

/** Serves the production build. Changing `release` changes the service worker's bytes, as a new deployment does. */
function serveBuild() {
  const state = { release: '', server: null as Server | null, url: '' };
  state.server = createServer((request, response) => {
    void (async () => {
      const path = normalize(new URL(request.url ?? '/', 'http://x').pathname);
      const file = join(DIST, path === '/' ? 'index.html' : path);
      try {
        let body: Buffer | string = await readFile(file);
        if (path === '/sw.js') body = `${body.toString()}\n// ${state.release}`;
        response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  return new Promise<typeof state>((resolve) => {
    state.server!.listen(0, '127.0.0.1', () => {
      const address = state.server!.address();
      state.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
      resolve(state);
    });
  });
}

const LEARNING_DATA = {
  words: [{ id: 'apfel', identityKey: 'Apfel|der', lemma: 'Apfel', article: 'der', pos: 'noun', plural: null, meanings: [{ text: 'elma', note: null }], senseTag: null, searchTokens: ['apfel', 'elma'], createdAt: 1000, updatedAt: 1000, favoritedAt: null, deletedAt: null }],
  cards: [{ wordId: 'apfel', track: 'de_tr', due: 9_999_999_999_999, schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1', fsrs: { stability: 3, difficulty: 5, dueAt: 9_999_999_999_999, lastReviewAt: 1000, state: 2, scheduleStatus: 'review', reps: 4, lapses: 0, elapsedDays: 1, scheduledDays: 3, learningSteps: 0 } }],
  reviewLogs: [{ mode: 'practice', wordId: 'apfel', track: 'de_tr', at: 1000, typed: 'elma', result: 'correct', hintsUsed: 0 }],
  groups: [{ id: 'mine', kind: 'custom', name: 'Zor', order: 0, sourceId: null, createdAt: 1000 }],
  groupMembers: [{ groupId: 'mine', wordId: 'apfel', addedAt: 1000, importRowId: null }],
};

const store = (page: Page) =>
  page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(Object.keys(data), 'readwrite');
          for (const [name, rows] of Object.entries(data)) for (const row of rows) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    LEARNING_DATA,
  );

const everyTable = (page: Page) =>
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
            read.onsuccess = () => {
              out[name] = read.result as unknown[];
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

test('a new version waits for the learner, then keeps every record and stays offline-ready', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot run service workers offline here; covered on Chromium');
  const site = await serveBuild();
  try {
    site.release = 'first';
    await page.goto(site.url);
    await expect(page.locator('h1')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await store(page);
    await page.evaluate(() => localStorage.setItem('vosli.theme', 'dark'));
    const before = await everyTable(page);
    expect(before.words).toHaveLength(1);

    site.release = 'second';
    const firstWorker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      return registration.active?.scriptURL;
    });
    expect(firstWorker).toBeTruthy();

    // Nothing changes until the learner agrees.
    const prompt = page.getByRole('button', { name: t.update.apply });
    await expect(prompt).toBeVisible({ timeout: 60_000 });
    expect(await everyTable(page)).toEqual(before);

    await Promise.all([page.waitForEvent('load'), prompt.click()]);
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(prompt).toBeHidden();

    expect(await everyTable(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem('vosli.theme'))).toBe('dark');
    const cached = await page.evaluate(async () => Boolean(await caches.match('dictionary/lemmas.txt', { ignoreSearch: true })) || (await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).some((entry) => entry.url.includes('dictionary/lemmas.txt'))))).some(Boolean));
    expect(cached).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    await page.goto(`${site.url}#/dictionary`);
    await expect(page.getByText('Apfel')).toBeVisible();
    await context.setOffline(false);
  } finally {
    site.server?.close();
  }
});
