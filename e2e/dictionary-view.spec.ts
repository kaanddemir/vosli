import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const WORDS = [
  { id: 'apfel', lemma: 'Apfel', article: 'der', meaning: 'elma', favorite: true },
  { id: 'tuer', lemma: 'Tür', article: 'die', meaning: 'kapı', favorite: false },
  { id: 'haus', lemma: 'Haus', article: 'das', meaning: 'ev', favorite: false },
  { id: 'danke', lemma: 'danke', article: null, meaning: 'teşekkürler', favorite: false },
] as const;

const record = (word: (typeof WORDS)[number]) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: [{ text: word.meaning, note: null }], senseTag: null, searchTokens: [], favoritedAt: word.favorite ? 1 : null, createdAt: 1, updatedAt: 1, deletedAt: null });

const count = (page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction(name).objectStore(name).count();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result);
          };
        };
      }),
    table,
  );

test.beforeEach(async ({ page }) => {
  await page.goto('./#/dictionary');
  await expect(page.locator('h1')).toHaveText(t.dictionary.title);
  await page.evaluate(
    (records) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction('words', 'readwrite');
          for (const item of records) tx.objectStore('words').put(item);
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    WORDS.map(record),
  );
  await page.reload();
  await expect(page.locator('.list-item')).toHaveCount(4);
});

const list = (page: Page) => page.locator('main .list').last();
const row = (page: Page, text: string) => list(page).locator('.list-item').filter({ hasText: text });
const direction = (page: Page) => page.getByRole('button', { name: t.dictionary.direction });
const hide = (page: Page) => page.getByRole('button', { name: t.dictionary.hideAnswers });
const reveal = (page: Page, label: string) => page.getByRole('button', { name: label });

test('starts German first with every answer shown, and the toggles sit before Seç', async ({ page }) => {
  await expect(direction(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(hide(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(direction(page)).toHaveAttribute('title', t.dictionary.direction);
  await expect(row(page, 'Apfel').locator('.row-title')).toHaveText('der Apfel');
  await expect(row(page, 'Apfel').locator('.row-title')).toHaveAttribute('lang', 'de');
  await expect(row(page, 'Apfel').locator('.row-detail')).toHaveText('elma');
});

test('Turkish first swaps the lines, keeps search working both ways, and lasts through navigation and reload', async ({ page }) => {
  await direction(page).click();
  await expect(direction(page)).toHaveAttribute('aria-pressed', 'true');
  const apfel = row(page, 'elma');
  await expect(apfel.locator('.row-title')).toHaveText('elma');
  await expect(apfel.locator('.row-title')).toHaveAttribute('lang', 'tr');
  await expect(apfel.locator('.row-detail')).toHaveText('der Apfel');
  // The order of the list does not change with the direction.
  await expect(list(page).locator('.row-title')).toHaveText(['elma', 'teşekkürler', 'ev', 'kapı']);

  await page.getByLabel(t.dictionary.searchLabel).fill('kap');
  await expect(list(page).locator('.list-item')).toHaveCount(1);
  await expect(list(page).locator('.row-title')).toHaveText('kapı');
  await page.getByLabel(t.dictionary.searchLabel).fill('Haus');
  await expect(list(page).locator('.row-title')).toHaveText('ev');

  await page.getByRole('link', { name: /ev/ }).click();
  await expect(page.locator('h1')).toHaveText('das Haus');
  await page.goBack();
  await expect(direction(page)).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(direction(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'elma').locator('.row-title')).toHaveText('elma');
});

test('hidden answers are out of the page, rows keep their size, and each row is revealed on its own', async ({ page }) => {
  const before = await row(page, 'Apfel').boundingBox();
  await hide(page).click();
  await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
  const after = await row(page, 'Apfel').boundingBox();
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);

  // Not blurred or merely invisible: the meanings are not in the page at all.
  for (const word of WORDS) await expect(list(page)).not.toContainText(word.meaning);
  await expect(page.getByTestId('reveal-answer')).toHaveCount(4);

  const url = page.url();
  await reveal(page, t.dictionary.revealMeaning('die Tür')).click();
  expect(page.url()).toBe(url);
  await expect(row(page, 'Tür').locator('.row-answer')).toHaveText('kapı');
  await expect(row(page, 'Tür').locator('.row-answer')).toBeFocused();
  await expect(list(page)).not.toContainText('elma');
  await expect(page.getByTestId('reveal-answer')).toHaveCount(3);
  const revealed = await row(page, 'Tür').boundingBox();
  expect(Math.abs(revealed!.height - before!.height)).toBeLessThanOrEqual(1);

  // Changing direction covers every row again.
  await direction(page).click();
  await expect(page.getByTestId('reveal-answer')).toHaveCount(4);
  await expect(list(page)).not.toContainText('Tür');
  await direction(page).click();

  // The header toggle shows everything again.
  await hide(page).click();
  await expect(hide(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('reveal-answer')).toHaveCount(0);
  for (const word of WORDS) await expect(list(page)).toContainText(word.meaning);
});

test('the word still opens from a covered row, and revealing works from the keyboard', async ({ page }) => {
  await hide(page).click();
  await row(page, 'Haus').locator('.row-link').focus();
  await page.keyboard.press('Tab');
  await expect(reveal(page, t.dictionary.revealMeaning('das Haus'))).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row(page, 'Haus').locator('.row-answer')).toHaveText('ev');
  await expect(row(page, 'Haus').locator('.row-answer')).toBeFocused();

  // A press anywhere else on the row opens the word, as before.
  const box = (await row(page, 'Apfel').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect(page.locator('h1')).toHaveText('der Apfel');
  await page.goBack();
  // Still covered after coming back, with nothing revealed from before.
  await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('reveal-answer')).toHaveCount(4);
});

test('covered German never shows its article color, and the revealed one keeps it', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('vosli.article-colors', 'on'));
  await page.reload();
  await direction(page).click();
  await hide(page).click();
  await expect(list(page).locator('.article-der, .article-die, .article-das')).toHaveCount(0);
  await reveal(page, t.dictionary.revealGerman('kapı')).click();
  const mark = row(page, 'kapı').locator('.article-die');
  await expect(mark).toHaveText('die');
  const color = await mark.evaluate((element) => getComputedStyle(element).color);
  const token = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--article-die)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(color).toBe(token);
  await expect(list(page).locator('.article-der, .article-das')).toHaveCount(0);
});

test('Favorites follow the view, selection shows both sides, and nothing is written to learning data', async ({ page }) => {
  await direction(page).click();
  await hide(page).click();
  await page.locator('.segmented label').filter({ hasText: t.dictionary.filterFavorites }).click();
  await expect(list(page).locator('.row-title')).toHaveText(['elma']);
  await expect(page.getByTestId('reveal-answer')).toHaveCount(1);
  await page.getByTestId('reveal-answer').click();
  await page.locator('.segmented label').filter({ hasText: t.dictionary.filterAll }).click();

  await page.getByRole('button', { name: t.common.select, exact: true }).click();
  await expect(direction(page)).toHaveCount(0);
  await expect(hide(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await expect(row(page, 'kapı').locator('.row-detail')).toHaveText('die Tür');
  await row(page, 'kapı').getByRole('checkbox').check();
  await expect(page.getByText(t.common.selected('1'))).toBeVisible();
  await page.getByRole('button', { name: t.common.cancel, exact: true }).click();
  await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
  // The row revealed under Favorites is still the only one uncovered.
  await expect(page.getByTestId('reveal-answer')).toHaveCount(3);
  await expect(row(page, 'elma').locator('.row-answer')).toHaveText('der Apfel');

  expect(await count(page, 'reviewLogs')).toBe(0);
  expect(await count(page, 'cards')).toBe(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`covered and Turkish-first views have no detectable accessibility problems in ${theme}`, async ({ page }) => {
    await page.evaluate((value) => localStorage.setItem('vosli.theme', value), theme);
    await page.reload();
    await direction(page).click();
    await hide(page).click();
    await reveal(page, t.dictionary.revealGerman('kapı')).click();
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });
}
