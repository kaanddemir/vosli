import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';
import { buildPdf, tablePage, type VocabRow } from '../tests/support/pdfBuilder';

const open = async (page: Page, hash = '#/import') => {
  await page.goto(`./${hash}`);
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
};
const SOURCE: readonly VocabRow[] = [['Geldautomat', 'das', 'ATM'], ['Moos', 'der', 'yosun'], ['Chor', 'das', 'koro'], ['Vier', 'die', 'dört'], ['Hund', 'der', 'köpek'], ['See', 'die', 'deniz']];
const file = (rows: readonly VocabRow[] = SOURCE) => ({ name: 'ders.pdf', mimeType: 'application/pdf', buffer: Buffer.from(buildPdf([tablePage(rows)])) });
const rows = (page: Page) => page.getByTestId('review-row');
const row = (page: Page, word: string) => rows(page).filter({ hasText: word });
const warning = (item: Locator) => item.getByRole('button', { name: /uyarı/ });
const filter = (page: Page, name: RegExp) => page.locator('.review-toolbar label').filter({ hasText: name });
const reviewed = async (page: Page, rowsToRead?: readonly VocabRow[]) => {
  await page.locator('input[type=file]').setInputFiles(file(rowsToRead));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.reviewTitle, { timeout: 30_000 });
};
const commit = async (page: Page) => {
  await page.locator('.review-commit .btn-primary').click();
  await page.getByRole('dialog').getByRole('button', { name: t.common.save }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.doneTitle);
};
const readTable = (page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction(name).objectStore(name).getAll();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result as Record<string, unknown>[]);
          };
        };
      }),
    table,
  );

test('a PDF review warns only where the dictionary has a reason, and never hides the list', async ({ page }) => {
  await open(page);
  await reviewed(page);
  await expect(rows(page)).toHaveCount(SOURCE.length);
  await expect(filter(page, /Uyarılar/)).toContainText('3');
  for (const word of ['Geldautomat', 'Moos', 'Chor']) await expect(warning(row(page, word))).toBeVisible();
  for (const word of ['Vier', 'Hund', 'See']) await expect(warning(row(page, word))).toHaveCount(0);

  await filter(page, /Uyarılar/).click();
  await expect(rows(page)).toHaveCount(3);
});

test('a suggestion changes a row only when pressed, and saving works either way', async ({ page }) => {
  await open(page);
  await reviewed(page);
  await expect(row(page, 'Geldautomat').locator('.article')).toHaveText('das ');

  await warning(row(page, 'Geldautomat')).click();
  const popover = page.locator('.popover-panel:popover-open');
  await expect(popover).toContainText(t.validation.issues.article_wrong);
  await popover.getByRole('button', { name: t.validation.apply('der Geldautomat') }).click();

  await expect(row(page, 'Geldautomat').locator('.article')).toHaveText('der ');
  await expect(warning(row(page, 'Geldautomat'))).toHaveCount(0);
  await expect(filter(page, /Uyarılar/)).toContainText('2');

  // Moos is rejected, Chor is left as it is. Neither stops the save.
  await warning(row(page, 'Moos')).click();
  await page.locator('.popover-panel:popover-open').getByRole('button', { name: t.import.warningAccept }).click();
  await expect(warning(row(page, 'Moos'))).toHaveCount(0);
  await commit(page);

  const words = await readTable(page, 'words');
  const articleOf = (lemma: string) => words.find((word) => word.lemma === lemma)?.article;
  expect([articleOf('Geldautomat'), articleOf('Moos'), articleOf('Chor')]).toEqual(['der', 'der', 'das']);
  const records = await readTable(page, 'importRows');
  expect(records.find((record) => record.german === 'Geldautomat')).toMatchObject({ article: 'der', extracted: { german: 'Geldautomat', article: 'das', turkish: 'ATM' } });
  expect((await readTable(page, 'meta')).find((entry) => entry.key === 'dictionaryDismissals')?.value).toEqual(['dict:article_wrong|der|Moos']);

  // The same file again: the correction stands, the rejection stays rejected, nothing new is asked.
  await page.getByRole('link', { name: t.nav.dictionary }).first().waitFor();
  await open(page);
  await reviewed(page);
  await expect(row(page, 'Geldautomat').locator('.article')).toHaveText('der ');
  await expect(warning(row(page, 'Geldautomat'))).toHaveCount(0);
  await expect(warning(row(page, 'Moos'))).toHaveCount(0);
  await expect(page.locator('.review-commit .form-hint')).toHaveCount(0);
});

test('a correction that meets a saved word asks a person instead of merging', async ({ page }) => {
  await open(page, '#/dictionary/new');
  await page.getByLabel(t.wordForm.german, { exact: true }).fill('Geldautomat');
  await page.locator('.segmented label').filter({ hasText: /^der$/ }).click();
  await page.getByLabel(t.wordForm.turkish, { exact: true }).fill('bankamatik');
  await page.getByRole('button', { name: t.common.save }).click();
  await expect(page).toHaveURL(/#\/dictionary\/[0-9a-f]{8}/);

  await open(page);
  await reviewed(page, [['Geldautomat', 'das', 'ATM']]);
  await page.locator('.review-toolbar label').filter({ hasText: t.import.filterAll }).click();
  const item = rows(page).first();
  // That row already asks, because a saved word has the other article.
  await expect(item.locator('select')).toBeVisible();
  await expect(page.locator('.review-commit .btn-primary')).toBeDisabled();
  expect(await readTable(page, 'words')).toHaveLength(1);
});

test('the warning works by keyboard, and focus is never lost', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard use');
  await open(page);
  await reviewed(page);
  const button = warning(row(page, 'Geldautomat'));
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.popover-panel:popover-open')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.popover-panel:popover-open')).toHaveCount(0);
  await expect(button).toBeFocused();

  await page.keyboard.press('Space');
  const apply = page.locator('.popover-panel:popover-open').getByRole('button', { name: t.validation.apply('der Geldautomat') });
  await apply.focus();
  await page.keyboard.press('Enter');
  await expect(row(page, 'Geldautomat').getByRole('button', { name: /düzenle/ })).toBeFocused();
});

test('a row shows what the dictionary knows only when opened', async ({ page }) => {
  await open(page);
  await reviewed(page);
  await expect(page.getByTestId('row-check')).toHaveCount(0);
  const see = row(page, 'See');
  await see.getByRole('button', { name: /düzenle/ }).click();
  await expect(see.getByTestId('row-check')).toHaveText(t.validation.articles('der, die'));
});

test('the word form warns after a pause, offers a fix, and keeps saving possible', { tag: '@smoke' }, async ({ page }) => {
  await open(page, '#/dictionary/new');
  const german = page.getByLabel(t.wordForm.german, { exact: true });
  await german.fill('Geldautomat');
  await page.locator('.segmented label').filter({ hasText: /^das$/ }).click();
  await page.getByLabel(t.wordForm.turkish, { exact: true }).fill('ATM');

  const icon = page.getByRole('button', { name: t.validation.label('Geldautomat') });
  await icon.click();
  await page.locator('.popover-panel:popover-open').getByRole('button', { name: t.validation.apply('der Geldautomat') }).click();
  await expect(icon).toHaveCount(0);
  await expect(page.locator('.segmented input[value=der]')).toBeChecked();
  await expect(german).toHaveValue('Geldautomat');

  await page.locator('.segmented label').filter({ hasText: /^das$/ }).click();
  await icon.click();
  await page.locator('.popover-panel:popover-open').getByRole('button', { name: t.import.warningAccept }).click();
  await expect(icon).toHaveCount(0);
  await page.getByRole('button', { name: t.common.save }).click();
  await expect(page).toHaveURL(/#\/dictionary\/[0-9a-f]{8}/);
  expect((await readTable(page, 'words'))[0]).toMatchObject({ lemma: 'Geldautomat', article: 'das' });
});

test('an unknown word is not called wrong, and an edit keeps the word and its identity', async ({ page }) => {
  await open(page, '#/dictionary/new');
  await page.getByLabel(t.wordForm.german, { exact: true }).fill('Xqzvbn');
  await expect(page.getByTestId('word-check-note')).toHaveText(t.validation.notFound);
  await page.getByLabel(t.wordForm.turkish, { exact: true }).fill('deneme');
  await page.getByRole('button', { name: t.common.save }).click();
  await expect(page).toHaveURL(/#\/dictionary\/[0-9a-f]{8}/);
  const [saved] = await readTable(page, 'words');
  expect(saved).toMatchObject({ lemma: 'Xqzvbn' });
});

test('with no dictionary file everything still works, and it says so', async ({ page }) => {
  await page.route('**/dictionary/**', (route) => route.abort());
  await open(page);
  await reviewed(page);
  await expect(rows(page)).toHaveCount(SOURCE.length);
  await expect(page.getByRole('button', { name: /uyarı/ })).toHaveCount(0);
  await page.getByRole('button', { name: t.import.infoLabel }).click();
  await expect(page.locator('.popover-panel:popover-open')).toContainText(t.validation.unavailable);
  await page.keyboard.press('Escape');
  await commit(page);
  expect(await readTable(page, 'words')).toHaveLength(SOURCE.length);
});

test('checks words offline once the app has been opened', async ({ page, context, isMobile, browserName }) => {
  test.skip(isMobile, 'One viewport is enough');
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot run service workers offline here; covered on Chromium');
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await reviewed(page);
  await expect(warning(row(page, 'Geldautomat'))).toBeVisible();
  await context.setOffline(false);
});

test('the main bundle does not load the dictionary until it is needed', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/dictionary/')) asked.push(request.url());
  });
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await page.goto('./#/dictionary');
  await expect(page.locator('h1')).toBeVisible();
  await page.waitForTimeout(300);
  expect(asked.filter((url) => !url.includes('sw'))).toEqual([]);
});

test('a real PDF of hundreds of rows opens quickly with all checks done', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Measured once');
  const many: VocabRow[] = Array.from({ length: 600 }, (_, index) => [`Testwort${index}`, 'der', `anlam ${index}`]);
  const pages = Array.from({ length: 20 }, (_, index) => tablePage(many.slice(index * 30, index * 30 + 30)));
  await open(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'buyuk.pdf', mimeType: 'application/pdf', buffer: Buffer.from(buildPdf(pages)) });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.reviewTitle, { timeout: 30_000 });
  await expect(rows(page).first()).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no accessibility violations with the warning open (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await reviewed(page);
    await warning(row(page, 'Geldautomat')).click();
    await expect(page.locator('.popover-panel:popover-open')).toBeVisible();
    const review = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(review.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);

    await open(page, '#/dictionary/new');
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('Geldautmat');
    await page.locator('.segmented label').filter({ hasText: /^der$/ }).click();
    await page.getByRole('button', { name: t.validation.label('Geldautmat') }).click();
    await expect(page.locator('.popover-panel:popover-open')).toBeVisible();
    // The open panel lies over the letter keys for as long as it is open, and any tap closes it.
    const form = await new AxeBuilder({ page }).exclude('.letters').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(form.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);

    await open(page, '#/settings');
    await expect(page.getByRole('link', { name: t.settings.dictionaryLicense })).toHaveAttribute('href', /by-sa\/4\.0/);
    // Colors ease in after a page load, and contrast can only be judged once they have arrived.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    const settings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(settings.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  });
}
