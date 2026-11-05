import { expect, test, type Locator, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

type Article = 'der' | 'die' | 'das';
const WORDS = [
  { id: 'apfel', lemma: 'Apfel', article: 'der', meaning: 'elma' },
  { id: 'tuer', lemma: 'Tür', article: 'die', meaning: 'kapı' },
  { id: 'haus', lemma: 'Haus', article: 'das', meaning: 'ev' },
  { id: 'danke', lemma: 'danke', article: null, meaning: 'teşekkürler' },
] as const;

const record = (word: (typeof WORDS)[number]) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: [{ text: word.meaning, note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });

async function seed(page: Page) {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
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
}

/** The color a token resolves to in the current theme, in the same form getComputedStyle reports. */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

const colorOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).color);
const toggle = (page: Page) => page.getByRole('switch', { name: t.settings.articleColors });

async function turnOn(page: Page) {
  await page.goto('./#/settings');
  await expect(toggle(page)).not.toBeChecked();
  await toggle(page).check();
  await expect(toggle(page)).toBeChecked();
}

test.describe('article colors', () => {
  test('are off by default, sit under Tema, and persist across reloads', async ({ page }) => {
    await page.goto('./#/settings');
    const appearance = page.locator('.list-section').filter({ has: page.getByRole('heading', { name: t.settings.appearance }) });
    await expect(appearance.locator('.list-item')).toHaveCount(2);
    await expect(appearance.locator('.list-item').nth(1)).toContainText(t.settings.articleColors);
    await expect(toggle(page)).not.toBeChecked();
    await expect(page.locator('html')).not.toHaveAttribute('data-article-colors');

    // The whole row is the target, not only the small switch.
    await appearance.locator('.switch-row .row-title').click();
    await expect(toggle(page)).toBeChecked();
    await page.reload();
    await expect(toggle(page)).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-article-colors', 'on');

    await toggle(page).uncheck();
    await page.reload();
    await expect(toggle(page)).not.toBeChecked();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`color only the article in the dictionary and word details (${theme})`, async ({ page }) => {
      await seed(page);
      await page.evaluate((value) => localStorage.setItem('vosli.theme', value), theme);
      await page.goto('./#/dictionary');
      await page.reload();
      const row = (lemma: string) => page.locator('.list-item').filter({ hasText: lemma });
      const plain = await colorOf(row('Apfel').locator('.article'));

      await turnOn(page);
      await page.goto('./#/dictionary');
      for (const article of ['der', 'die', 'das'] as const satisfies readonly Article[]) {
        const word = WORDS.find((item) => item.article === article)!;
        const mark = row(word.lemma).locator(`.article-${article}`);
        await expect(mark).toHaveText(article);
        expect(await colorOf(mark)).toBe(await tokenColor(page, `--article-${article}`));
        // The word itself keeps its own color.
        expect(await colorOf(row(word.lemma).locator('.row-title'))).toBe(await tokenColor(page, '--text'));
      }
      expect(await colorOf(row('Apfel').locator('.article'))).not.toBe(plain);
      await expect(row('danke').locator('[class*="article"]')).toHaveCount(0);
      await expect(row('danke').locator('.row-title')).toHaveText('danke');

      await row('Tür').locator('a').click();
      await expect(page.locator('h1')).toHaveText('die Tür');
      expect(await colorOf(page.locator('h1 .article-die'))).toBe(await tokenColor(page, '--article-die'));
    });
  }

  test('stay hidden in practice until the answer is shown', async ({ page }) => {
    await seed(page);
    await turnOn(page);
    await page.goto('./#/practice');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.practice.title);
    await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.modes.article}$`) }).click();
    await page.getByRole('button', { name: t.practice.start }).click();

    for (let i = 0; i < 3; i++) {
      const prompt = await page.getByTestId('practice-question').innerText();
      const word = WORDS.find((item) => item.lemma === prompt)!;
      // Before answering, nothing on screen carries an article color.
      await expect(page.locator('.article-choice').first()).toBeVisible();
      await expect(page.locator('.article-der, .article-die, .article-das')).toHaveCount(0);

      await page.getByTestId('practice-reveal').click();
      const shown = page.getByTestId('practice-answer-shown');
      await expect(shown).toContainText(`${word.article} ${word.lemma}`);
      expect(await colorOf(shown.locator(`.article-${word.article}`))).toBe(await tokenColor(page, `--article-${word.article}`));
      await page.getByTestId('practice-action').click();
      await expect(page.getByTestId('practice-feedback')).toHaveCount(0);
    }
  });
});
