import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const SCREENS = [
  { hash: '#/dictionary', title: t.dictionary.emptyTitle, support: t.dictionary.emptySupport, primary: t.dictionary.addWord },
  { hash: '#/collections', title: t.collections.emptyTitle, support: t.collections.emptySupport, primary: t.collections.create },
];

const open = async (page: Page, hash: string, title: string) => {
  await page.goto(`./${hash}`);
  await expect(page.getByText(title)).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
};

for (const { hash, title, support, primary } of SCREENS) {
  test(`${hash} greets with the fox, the text and clear actions`, async ({ page }) => {
    await open(page, hash, title);
    await expect(page.locator('.empty-fox')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByText(support)).toBeVisible();
    await expect(page.getByRole('main').locator('.empty-actions .btn-primary')).toHaveText(primary);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`${hash} has no accessibility problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, hash, title);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    });
  }

  for (const [width, height] of [[320, 568], [390, 844], [667, 375]] as const) {
    test(`${hash} fits at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page, hash, title);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      const art = (await page.locator('.empty-fox').boundingBox())!;
      expect(art.width).toBeLessThanOrEqual(220);
      const text = (await page.getByText(title).boundingBox())!;
      expect(text.y).toBeGreaterThanOrEqual(art.y + art.height - 12);
    });
  }
}

test('other empty messages stay plain, so the fox marks only a real first visit', async ({ page }) => {
  await page.goto('./#/collections/none');
  await expect(page.getByText(t.collections.notFound).first()).toBeVisible();
  await expect(page.locator('.empty-fox')).toHaveCount(0);
});

const centerGap = (page: Page) =>
  page.evaluate(() => {
    const empty = document.querySelector('.empty')!;
    const items = [...empty.children].map((el) => el.getBoundingClientRect());
    const top = Math.min(...items.map((box) => box.top));
    const bottom = Math.max(...items.map((box) => box.bottom));
    const above = (document.querySelector('.search') ?? document.querySelector('.page-header'))!.getBoundingClientRect().bottom;
    const main = document.querySelector('main')!;
    const below = main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom);
    return { spaceAbove: top - above, spaceBelow: below - bottom, scroll: document.documentElement.scrollHeight - innerHeight };
  });

for (const { hash, title } of SCREENS) {
  for (const [width, height] of [[1440, 900], [1100, 700], [2560, 1300]] as const) {
    test(`${hash} rests in the middle of the space below the header at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page, hash, title);
      const { spaceAbove, spaceBelow, scroll } = await centerGap(page);
      // The gap between the header and the content adds to the space above.
      expect(Math.abs(spaceAbove - spaceBelow)).toBeLessThanOrEqual(26);
      expect(spaceAbove).toBeGreaterThan(24);
      expect(scroll).toBe(0);
    });
  }

  for (const [width, height] of [[390, 844], [1280, 600], [320, 568]] as const) {
    test(`${hash} follows the header at ${width}x${height}, without scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page, hash, title);
      const { spaceAbove, spaceBelow, scroll } = await centerGap(page);
      expect(spaceAbove).toBeLessThanOrEqual(80);
      expect(spaceBelow).toBeGreaterThanOrEqual(0);
      expect(scroll).toBe(0);
    });
  }
}

test.describe('no favorites yet', () => {
  const openFavorites = async (page: Page) => {
    await page.goto('./#/dictionary');
    await expect(page.locator('h1')).toHaveText(t.dictionary.title);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('vosli');
          open.onsuccess = () => {
            const tx = open.result.transaction('words', 'readwrite');
            tx.objectStore('words').put({ id: 'apfel', identityKey: 'Apfel|der', lemma: 'Apfel', article: 'der', pos: 'noun', plural: null, meanings: [{ text: 'elma', note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload();
    await page.locator('.segmented label').filter({ hasText: t.dictionary.filterFavorites }).click();
    await expect(page.getByText(t.dictionary.noFavorites)).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  };

  test('shows the fox and a line of explanation, and no buttons', async ({ page }) => {
    await openFavorites(page);
    await expect(page.locator('.empty-fox')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.empty-fox-heart')).toHaveCount(1);
    await expect(page.getByText(t.dictionary.noFavoritesSupport)).toBeVisible();
    await expect(page.locator('.empty .btn')).toHaveCount(0);
  });

  test('a search with no results stays plain', async ({ page }) => {
    await openFavorites(page);
    await page.getByLabel(t.dictionary.searchLabel).fill('yokbuyle');
    await expect(page.getByText(t.dictionary.noResults('yokbuyle'))).toBeVisible();
    await expect(page.locator('.empty-fox')).toHaveCount(0);
  });

  test('going back to all words brings the list back', async ({ page }) => {
    await openFavorites(page);
    await page.locator('.segmented label').filter({ hasText: t.dictionary.filterAll }).click();
    await expect(page.getByRole('link', { name: /Apfel/ })).toBeVisible();
    await expect(page.locator('.empty-fox')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no accessibility problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openFavorites(page);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    });
  }

  for (const [width, height] of [[1440, 900], [2560, 1300]] as const) {
    test(`rests in the middle of the space below the filter at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openFavorites(page);
      const { above, below, scroll } = await page.evaluate(() => {
        const items = [...document.querySelector('.empty')!.children].map((el) => el.getBoundingClientRect());
        const main = document.querySelector('main')!;
        return {
          above: Math.min(...items.map((box) => box.top)) - document.querySelector('.filter-row')!.getBoundingClientRect().bottom,
          below: main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom) - Math.max(...items.map((box) => box.bottom)),
          scroll: document.documentElement.scrollHeight - innerHeight,
        };
      });
      expect(Math.abs(above - below)).toBeLessThanOrEqual(26);
      expect(scroll).toBe(0);
    });
  }

  for (const [width, height] of [[320, 568], [390, 844], [1280, 600]] as const) {
    test(`fits at ${width}x${height} with the same size of picture as the others`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openFavorites(page);
      const size = (await page.locator('.empty-fox').boundingBox())!.width;
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      await expect(page.getByText(t.dictionary.noFavoritesSupport)).toBeInViewport({ ratio: 1 });
      await page.goto('./#/collections');
      await expect(page.getByText(t.collections.emptyTitle)).toBeVisible();
      expect(Math.abs((await page.locator('.empty-fox').boundingBox())!.width - size)).toBeLessThanOrEqual(1);
    });
  }
});
