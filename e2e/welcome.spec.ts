import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { tr } from '../src/i18n/tr';
import { expect, test } from './fixtures';

/** The first start: a new learner meets the welcome; anyone who used Vosli before never does. */

async function meta(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction('meta').objectStore('meta').getAll();
          read.onsuccess = () => {
            request.result.close();
            resolve(Object.fromEntries((read.result as { key: string; value: unknown }[]).map((row) => [row.key, row.value])));
          };
        };
      }),
  );
}

const welcome = (page: Page) => page.locator('dialog.welcome-dialog');
const savedLocale = (page: Page) => page.evaluate(() => localStorage.getItem('vosli.locale'));

test.describe('a new learner', () => {
  test.use({ existingLearner: false });

  test('is welcomed over Home, with English chosen, no learning language yet and Continue waiting', async ({ page }) => {
    await page.goto('./#/dictionary');
    await expect(welcome(page)).toBeVisible();
    await expect(welcome(page).getByRole('heading', { level: 2 })).toHaveText(en.welcome.title);
    // The real Home is behind it, whatever address the page opened at.
    await expect(page.locator('h1.today-title')).toHaveText(en.home.title);
    const interfaceGroup = welcome(page).getByRole('group', { name: en.welcome.interface });
    await expect(interfaceGroup.getByRole('radio')).toHaveCount(3);
    await expect(interfaceGroup.getByRole('radio', { name: 'English' })).toBeChecked();
    await expect(interfaceGroup.getByRole('radio', { name: 'English' })).toBeFocused();
    const learningGroup = welcome(page).getByRole('group', { name: en.welcome.learning });
    await expect(learningGroup.getByRole('radio', { name: en.lang.de.name })).not.toBeChecked();
    await expect(learningGroup.getByRole('radio', { name: en.lang.en.name })).not.toBeChecked();
    await expect(page.getByTestId('welcome-continue')).toBeDisabled();
  });

  test('cannot be dismissed: not by Escape, twice, nor the backdrop, and Tab stays inside', async ({ page }) => {
    await page.goto('./');
    await expect(welcome(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(welcome(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(welcome(page)).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('dialog.welcome-dialog') !== null || document.activeElement === document.body)).toBe(true);
    }
    expect(await meta(page)).not.toHaveProperty('onboarding');
  });

  test('translates at once when another interface language is tried, but saves nothing until Continue', async ({ page }) => {
    await page.goto('./');
    await welcome(page).getByRole('radio', { name: 'Türkçe' }).check();
    await expect(welcome(page).getByRole('heading', { level: 2 })).toHaveText(tr.welcome.title);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.locator('h1.today-title')).toHaveText(tr.home.title);
    expect(await savedLocale(page)).toBeNull();
    // Nothing was chosen yet, so a reload starts the welcome over, in English.
    await page.reload();
    await expect(welcome(page).getByRole('heading', { level: 2 })).toHaveText(en.welcome.title);
    expect(await savedLocale(page)).toBeNull();
  });

  test('saves both choices on Continue: English to learn, in a Turkish interface, kept after a reload', async ({ page }) => {
    await page.goto('./');
    await welcome(page).getByRole('radio', { name: 'Türkçe' }).check();
    await welcome(page).getByRole('group', { name: tr.welcome.learning }).getByRole('radio', { name: tr.lang.en.name }).check();
    await expect(page.getByTestId('welcome-continue')).toBeEnabled();
    await page.getByTestId('welcome-continue').click();
    await expect(welcome(page)).toHaveCount(0);
    // The welcome is the choice itself: Settings' question before a switch never follows it.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: tr.lang.en.switchTitle })).toHaveCount(0);
    expect(await savedLocale(page)).toBe('tr');
    expect(await meta(page)).toMatchObject({ learningLanguage: 'en', onboarding: { via: 'welcome' } });
    await page.reload();
    await expect(page.locator('h1.today-title')).toHaveText(tr.home.title);
    await expect(welcome(page)).toHaveCount(0);
    await expect(page.getByTestId('home-workspace')).toHaveText(tr.home.workspace(0));
  });

  test('comes back after Reset all data, in the interface language kept, with no learning language chosen', async ({ page }) => {
    await page.goto('./');
    await welcome(page).getByRole('radio', { name: 'Deutsch' }).check();
    await welcome(page).getByRole('group', { name: de.welcome.learning }).getByRole('radio', { name: de.lang.de.name }).check();
    await page.getByTestId('welcome-continue').click();
    await expect(welcome(page)).toHaveCount(0);
    await page.goto('./#/settings');
    await page.getByRole('button', { name: de.settings.reset }).click();
    await page.getByRole('dialog', { name: de.settings.resetTitle }).getByRole('button', { name: de.settings.resetConfirm }).click();
    await expect(welcome(page)).toBeVisible();
    await expect(welcome(page).getByRole('heading', { level: 2 })).toHaveText(de.welcome.title);
    await expect(welcome(page).getByRole('group', { name: de.welcome.interface }).getByRole('radio', { name: 'Deutsch' })).toBeChecked();
    await expect(page.getByTestId('welcome-continue')).toBeDisabled();
    expect(await savedLocale(page)).toBe('de');
    expect(await meta(page)).not.toHaveProperty('onboarding');
  });

  test('finishing in one tab closes the welcome in another', async ({ page, context }) => {
    await page.goto('./');
    const other = await context.newPage();
    await other.goto('./');
    await expect(welcome(other)).toBeVisible();
    await welcome(page).getByRole('group', { name: en.welcome.learning }).getByRole('radio', { name: en.lang.de.name }).check();
    await page.getByTestId('welcome-continue').click();
    await expect(welcome(other)).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`fits at 320px with 200% text, keyboard-ready and accessible, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('./');
      await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
      await expect(welcome(page)).toBeVisible();
      const box = (await welcome(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await welcome(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      // Text this large leaves no room for the fox, so it steps aside.
      await expect(page.locator('.welcome-fox')).toBeHidden();
      // Chosen from the keyboard alone: arrows move within a group, Tab moves on.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Space');
      const continueButton = page.getByTestId('welcome-continue');
      await expect(continueButton).toBeEnabled();
      await continueButton.scrollIntoViewIfNeeded();
      await expect(continueButton).toBeInViewport();
      expect((await continueButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    });
  }

  test('shows the fox where there is room, blurs Home behind it, and does not move when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await expect(page.locator('.welcome-fox')).toBeVisible();
    expect(await welcome(page).evaluate((element) => getComputedStyle(element, '::backdrop').backdropFilter)).toContain('blur');
    expect(await welcome(page).evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  });
});

test.describe('a learner from before', () => {
  test('is never welcomed, keeps German and the interface language unsaved, even with no words at all', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('h1.today-title')).toHaveText(en.home.title);
    await expect(welcome(page)).toHaveCount(0);
    expect(await meta(page)).toMatchObject({ learningLanguage: 'de', onboarding: { via: 'legacy' } });
    expect(await savedLocale(page)).toBeNull();
    await page.reload();
    await expect(welcome(page)).toHaveCount(0);
  });
});
