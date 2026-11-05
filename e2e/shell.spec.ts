import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const SCREENS = [
  { hash: '#/', heading: t.home.title, nav: t.nav.home },
  { hash: '#/dictionary', heading: t.dictionary.title, nav: t.nav.dictionary },
  { hash: '#/collections', heading: t.collections.title, nav: t.nav.collections },
  { hash: '#/practice', heading: t.practice.title, nav: null },
  { hash: '#/import', heading: t.import.title, nav: null },
  { hash: '#/settings', heading: t.settings.title, nav: null },
];

async function open(page: Page, hash = '#/') {
  await page.goto(`./${hash}`);
  await expect(page.locator('h1')).toBeVisible();
  // The screen fades in; contrast is only meaningful once it has settled.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('navigation', () => {
  test('reaches every main screen from the menu', { tag: '@smoke' }, async ({ page }) => {
    await open(page);
    const nav = page.getByRole('navigation', { name: t.mainNav });
    for (const screen of SCREENS) {
      if (!screen.nav) continue;
      await nav.getByRole('link', { name: screen.nav }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(screen.heading);
      await expect(nav.getByRole('link', { name: screen.nav })).toHaveAttribute('aria-current', 'page');
      await expect(page).toHaveTitle(t.appName);
    }
  });

  test('reaches Settings from the menu on wide screens and from Bugün on phones', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: t.nav.settings }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.settings.title);
  });

  test('reaches Import from Bugün and from Collections', async ({ page }) => {
    await open(page);
    await page.getByRole('main').getByRole('link', { name: t.nav.import }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.title);
    await page.getByRole('link', { name: t.nav.collections }).first().click();
    await page.getByRole('main').getByRole('link', { name: t.nav.import }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.title);
  });

  test('Practice is unavailable without words and opens once words exist', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('button', { name: t.home.freePractice })).toBeDisabled();
    await putWord(page, 'a', 'Fuß');
    await page.reload();
    await page.getByRole('link', { name: t.home.freePractice }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.practice.title);
  });

  test('Practice has no menu and closes back to Bugün', async ({ page }) => {
    await open(page, '#/practice');
    await expect(page.getByRole('navigation', { name: t.mainNav })).toHaveCount(0);
    await page.getByRole('link', { name: t.common.close }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.home.title);
    await expect(page.getByRole('navigation', { name: t.mainNav })).toBeVisible();
  });

  test('sends an unknown address home', async ({ page }) => {
    await open(page, '#/not-a-page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.home.title);
  });

  test('moves focus to the new screen', async ({ page }) => {
    await open(page);
    await page.getByRole('navigation', { name: t.mainNav }).getByRole('link', { name: t.nav.dictionary }).click();
    await expect(page.locator('main')).toBeFocused();
  });
});

test.describe('keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop keyboard only');

  test('skip link is first and moves to the content', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari skips links on Tab by default; the next test covers WebKit');
    await open(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t.skipToContent })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('menu links can be focused and opened with Enter', async ({ page }) => {
    await open(page);
    const link = page.getByRole('navigation', { name: t.mainNav }).getByRole('link', { name: t.nav.collections });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.collections.title);
  });

  test('tab order visits all menu links', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari skips links on Tab by default');
    await open(page);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() || ''));
    }
    for (const label of [t.nav.home, t.nav.dictionary, t.nav.collections, t.nav.settings]) expect(seen).toContain(label);
  });

  test('Escape leaves Practice', async ({ page }) => {
    await open(page, '#/practice');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.home.title);
  });

  test('theme radios work with arrow keys', async ({ page, browserName }) => {
    await open(page, '#/settings');
    await page.getByRole('radio', { name: t.settings.themes.system }).focus();
    await page.keyboard.press('ArrowRight');
    if (browserName !== 'webkit') await expect(page.getByRole('radio', { name: t.settings.themes.light })).toBeChecked();
    await page.getByRole('radio', { name: t.settings.themes.dark }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: t.settings.themes.dark })).toBeChecked();
    expect(await theme(page)).toBe('dark');
  });

  test('focus indicator is visible on menu links', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari skips links on Tab by default');
    await open(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('navigation', { name: t.mainNav }).getByRole('button', { name: t.collapseMenu })).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('navigation', { name: t.mainNav }).getByRole('link', { name: t.nav.home })).toBeFocused();
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).toBe('solid');
  });
});

test.describe('themes', () => {
  test('System follows the operating system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    expect(await theme(page)).toBe('dark');
    expect(await background(page)).toBe('rgb(25, 25, 25)');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => theme(page)).toBe('light');
    expect(await background(page)).toBe('rgb(247, 245, 241)');
  });

  test('Light and Dark override the system and survive a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, '#/settings');
    await page.getByRole('radio', { name: t.settings.themes.dark }).check();
    expect(await theme(page)).toBe('dark');
    expect(await background(page)).toBe('rgb(25, 25, 25)');
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect(await theme(page)).toBe('dark');
    await page.getByRole('radio', { name: t.settings.themes.light }).check();
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await theme(page)).toBe('light');
    expect(await background(page)).toBe('rgb(247, 245, 241)');
  });

  test('the saved theme applies before the app script runs', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('vosli.theme', 'dark'));
    await page.route('**/assets/index-*.js', (route) => route.abort());
    await page.goto('./');
    expect(await theme(page)).toBe('dark');
    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#191919');
  });
});

test.describe('layout', () => {
  for (const width of [320, 360, 390, 768, 1280]) {
    test(`has no horizontal overflow at ${width}px on any screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const screen of SCREENS) {
        await open(page, screen.hash);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${screen.hash} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('menu is a bottom bar on phones and a sidebar on wide screens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page);
    const nav = page.getByRole('navigation', { name: t.mainNav });
    expect((await nav.boundingBox())!.y).toBeGreaterThan(700);
    await expect(nav.getByRole('link')).toHaveCount(3);
    await page.setViewportSize({ width: 1280, height: 800 });
    const box = (await nav.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.height).toBe(800);
    expect(box.width).toBeLessThan(300);
    await expect(page.getByRole('link', { name: t.nav.settings })).toHaveCount(1);
  });

  test('storage protection is asked for automatically, and Settings has no row about it', async ({ page }) => {
    await page.addInitScript(() => {
      const counter = window as unknown as { persistAsked: number };
      counter.persistAsked = 0;
      StorageManager.prototype.persist = async () => {
        counter.persistAsked++;
        return false;
      };
    });
    await open(page, '#/settings');
    await expect.poll(() => page.evaluate(() => (window as unknown as { persistAsked: number }).persistAsked)).toBe(1);
    await expect(page.getByRole('main')).not.toContainText('Depolama');
    await expect(page.getByRole('main')).not.toContainText('Kalıcı');
    await expect(page.getByRole('button', { name: t.settings.download })).toBeVisible();
    await expect(page.getByRole('button', { name: t.settings.restore })).toBeVisible();
  });

  test('the bottom menu does not cover the last content', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 560 });
    await open(page, '#/settings');
    // The last credit is the last content on the page.
    await page.locator('.source-credit').last().scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const text = (await page.locator('.source-credit').last().boundingBox())!;
    const nav = (await page.getByRole('navigation', { name: t.mainNav }).boundingBox())!;
    expect(text.y + text.height).toBeLessThanOrEqual(nav.y);
  });

  test('menu and buttons meet the 44px touch target', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page, '#/settings');
    const sizes = await page.locator('.nav-link, .icon-btn, .btn, .row-press, .segmented span').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    const visible = sizes.filter((height) => height > 0); // Phone-only and sidebar-only controls are not rendered here.
    expect(visible.length).toBeGreaterThanOrEqual(5);
    for (const height of visible) expect(height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('typography', () => {
  test('uses Fira Sans, including Turkish and German letters', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Fira Sans');
    const loaded = await page.evaluate(async () => {
      await Promise.all(['400', '500', '600'].flatMap((w) => [document.fonts.load(`${w} 16px "Fira Sans"`, 'ağşıİ'), document.fonts.load(`${w} 16px "Fira Sans"`, 'äöüß')]));
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.family.includes('Fira Sans') && f.status === 'loaded').length;
    });
    expect(loaded).toBeGreaterThanOrEqual(6);
  });
});

test.describe('accessibility', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`no automatically detectable problems in ${colorScheme}`, { tag: '@smoke' }, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      for (const screen of SCREENS) {
        await open(page, screen.hash);
        await page.evaluate(() => document.fonts.ready);
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${screen.hash}: ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      }
    });
  }
});

// ---- Helpers that use IndexedDB directly: the production page exposes no test hooks.
async function putWord(page: Page, id: string, lemma: string) {
  await page.evaluate(
    ({ id, lemma }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('vosli');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('words', 'readwrite');
          tx.objectStore('words').put({ id, identityKey: `${lemma}|`, lemma, article: null, pos: 'other', plural: null, meanings: [{ text: 'çeviri', note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { id, lemma },
  );
}

const readWords = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('vosli');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('words').objectStore('words').getAll();
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { lemma: string }[]).map((w) => w.lemma).sort());
          };
        };
      }),
  );

test.describe('backup and restore through the interface', () => {
  test.skip(({ isMobile }) => isMobile, 'Covered on desktop; downloads differ on mobile emulation');

  test('downloads a backup, then restores it over changed data', { tag: '@smoke' }, async ({ page }) => {
    await open(page, '#/settings');
    await putWord(page, 'a', 'Fuß');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: t.settings.download }).click()]);
    expect(download.suggestedFilename()).toMatch(/^vosli-yedek-.*\.json$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain('Fuß');
    await expect(page.getByTestId('last-backup')).not.toHaveText(t.settings.never);

    await putWord(page, 'b', 'Später');
    expect(await readWords(page)).toEqual(['Fuß', 'Später']);

    await page.locator('input[type=file]').setInputFiles({ name: 'yedek.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    const dialog = page.getByRole('dialog', { name: t.restore.title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: t.common.cancel })).toBeVisible();

    const [safety] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: t.restore.confirm }).click()]);
    expect(safety.suggestedFilename()).toMatch(/yedek/);
    await expect(page.getByRole('status').filter({ hasText: t.restore.done })).toBeVisible();
    expect(await readWords(page)).toEqual(['Fuß']);
  });

  test('cancelling a restore changes nothing', async ({ page }) => {
    await open(page, '#/settings');
    await putWord(page, 'a', 'Fuß');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: t.settings.download }).click()]);
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
    await putWord(page, 'b', 'Später');
    await page.locator('input[type=file]').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.concat(chunks) });
    const dialog = page.getByRole('dialog', { name: t.restore.title });
    await dialog.getByRole('button', { name: t.common.cancel }).click();
    await expect(dialog).toBeHidden();
    expect(await readWords(page)).toEqual(['Fuß', 'Später']);
  });

  test('rejects an invalid file and keeps data', async ({ page }) => {
    await open(page, '#/settings');
    await putWord(page, 'a', 'Fuß');
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
    await expect(page.getByRole('status').filter({ hasText: t.restore.errors.not_a_backup })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readWords(page)).toEqual(['Fuß']);
  });

  test('home shows a reminder once there are words and no backup', async ({ page }) => {
    await open(page);
    await expect(page.getByText(t.home.backupDue)).toHaveCount(0);
    await putWord(page, 'a', 'Fuß');
    await page.reload();
    await expect(page.getByText(t.home.backupDue)).toBeVisible();
  });
});

test.describe('data safety in the app', () => {
  test('explains a newer database and leaves it unchanged', async ({ page }) => {
    await open(page);
    await putWord(page, 'a', 'Fuß');
    // Upgrade the stored database as a newer release would.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('vosli', 90);
          req.onerror = () => reject(req.error);
          req.onupgradeneeded = () => req.result.createObjectStore('futureTable');
          req.onsuccess = () => {
            req.result.close();
            resolve();
          };
        }),
    );
    await expect(page.getByTestId('db-error')).toHaveText(t.dbError.closed);
    await page.reload();
    await expect(page.getByTestId('db-error')).toHaveText(t.dbError.newer);
    expect(await readWords(page)).toEqual(['Fuß']);
    expect(await page.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === 'vosli')?.version)).toBe(90);
  });

  test('data survives a reload', { tag: '@smoke' }, async ({ page }) => {
    await open(page);
    await putWord(page, 'a', 'Fuß');
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect(await readWords(page)).toEqual(['Fuß']);
  });
});

test.describe('offline', () => {
  test('the installed app and fonts work without a connection', { tag: '@smoke' }, async ({ page, context }) => {
    await open(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.home.title);
    await page.getByRole('navigation', { name: t.mainNav }).getByRole('link', { name: t.nav.dictionary }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.dictionary.title);
    const fontOk = await page.evaluate(async () => {
      const faces = await document.fonts.load('600 16px "Fira Sans"', 'ağşıİäöüß');
      return faces.length > 0 && faces.every((f) => f.status === 'loaded');
    });
    expect(fontOk).toBe(true);
    await context.setOffline(false);
  });
});
