import { expect, test } from '@playwright/test';

const HARNESS = 'http://127.0.0.1:4174/e2e/harness.html';

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await page.waitForFunction(() => 'runHarness' in window);
});

const run = (page: import('@playwright/test').Page, name: string) => page.evaluate((test) => (window as unknown as { runHarness: (t: string) => Promise<unknown> }).runHarness(test), name);

test('a failed log write rolls the card back', async ({ page }) => {
  expect(await run(page, 'atomicAnswer')).toEqual({ rejected: true, due: true, logs: 0 });
});

test('one answer is scheduled once, even from three connections at once', { tag: '@smoke' }, async ({ page }) => {
  expect(await run(page, 'reviewSavedOnceAcrossTabs')).toEqual({ saved: 1, logs: 1, reps: 1 });
});

test('a failed review write leaves no card and no log', { tag: '@smoke' }, async ({ page }) => {
  expect(await run(page, 'reviewRollsBack')).toEqual({ rejected: true, cards: 0, logs: 0 });
});

test('changing an article removes the cards that depend on it', async ({ page }) => {
  expect(await run(page, 'articleChangeResetsOneCard')).toEqual(['de_tr']);
});

test('Free Practice changes no scheduled state', async ({ page }) => {
  expect(await run(page, 'practiceIsolation')).toBe(true);
});

test('backup and restore reproduce every table', { tag: '@smoke' }, async ({ page }) => {
  expect(await run(page, 'backupRoundTrip')).toEqual({ same: true, fuss: 'Fuß' });
});

test('a failed restore keeps existing data', { tag: '@smoke' }, async ({ page }) => {
  expect(await run(page, 'failedRestoreKeepsData')).toEqual({ rejected: true, ids: ['keep'] });
});

test('a database from a newer version is refused and left unchanged', async ({ page }) => {
  expect(await run(page, 'newerSchemaRefused')).toEqual({ refused: true, words: 1, verno: 2 });
});

test('a failed migration rolls back', async ({ page }) => {
  expect(await run(page, 'failedMigrationRollsBack')).toEqual({ reported: true, lemma: 'Fuß', damaged: false, verno: 1 });
});

test('an upgrade in another tab closes this connection and notifies it', async ({ page }) => {
  expect(await run(page, 'upgradeClosesOtherConnection')).toEqual({ notified: true, firstOpen: false, secondVersion: 2 });
});

test('a failed import leaves every table as it was', async ({ page }) => {
  expect(await run(page, 'importRollsBack')).toEqual({ rejected: true, same: true });
});

test('editing keeps review logs and drops stale schedules; deleting removes only that word; adding it again starts fresh', async ({ page }) => {
  expect(await run(page, 'wordEditAndDelete')).toEqual({ editKeptLogs: true, editDroppedCards: true, gone: true, fresh: true, kept: true });
});

test('a failed delete changes nothing', async ({ page }) => {
  expect(await run(page, 'deleteRollsBack')).toEqual({ rejected: true, same: true });
});

test('deleting a list or a source collection keeps words and history', async ({ page }) => {
  expect(await run(page, 'groupDeleteProtectsData')).toEqual({ sourceGone: true, kept: true, sourceMember: 'r1' });
});

test('FSRS-6 gives the validated chain in this browser', async ({ page }) => {
  expect(await run(page, 'fsrsChain')).toEqual([2, 11, 46, 163, 498, 1348]);
});

test('FSRS state survives IndexedDB and continues identically', async ({ page }) => {
  expect(await run(page, 'fsrsStoredAndContinued')).toBe(true);
});
