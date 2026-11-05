import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

const nav = (page: Page) => page.getByRole('navigation', { name: t.mainNav });
const collapseButton = (page: Page) => nav(page).getByRole('button', { name: t.collapseMenu });
const expandButton = (page: Page) => nav(page).getByRole('button', { name: t.expandMenu });
const width = async (page: Page) => (await nav(page).boundingBox())!.width;
const open = async (page: Page, hash = '#/') => {
  await page.goto(`./${hash}`);
  await expect(page.locator('h1')).toBeVisible();
};
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

// Animation has its own tests below. Elsewhere each state is measured as soon as it is reached.
test.use({ viewport: { width: 1280, height: 800 }, contextOptions: { reducedMotion: 'reduce' } });

test('starts expanded, exactly as before', async ({ page }) => {
  await open(page);
  expect(await width(page)).toBe(240);
  await expect(nav(page).getByText(t.nav.dictionary)).toBeVisible();
  await expect(collapseButton(page)).toBeVisible();
});

test('collapses to icons only, keeping names, tooltips, the current page and Settings', async ({ page, browserName }) => {
  await open(page, '#/dictionary');
  await collapseButton(page).click();
  expect(await width(page)).toBe(72);
  // Safari does not focus a button on click.
  if (browserName !== 'webkit') await expect(expandButton(page)).toBeFocused();
  await expect(expandButton(page)).toHaveAttribute('title', t.expandMenu);
  for (const label of [t.nav.home, t.nav.dictionary, t.nav.collections, t.nav.settings]) {
    const link = nav(page).getByRole('link', { name: label });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('title', label);
    const box = (await link.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(nav(page).getByRole('link', { name: t.nav.dictionary })).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).getByRole('link', { name: t.appName })).toBeVisible();
  await expect(nav(page).locator('.brand-mark')).toBeVisible();
  await nav(page).getByRole('link', { name: t.nav.settings }).click();
  await expect(page.locator('h1')).toHaveText(t.settings.title);
  expect(await width(page)).toBe(72);
});

test('the choice survives a reload, and is already applied before the app starts', async ({ page }) => {
  await open(page);
  await collapseButton(page).click();
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { early?: string | undefined }).early = document.documentElement.dataset.sidebar;
    });
  });
  await page.reload();
  await expect(expandButton(page)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { early?: string | undefined }).early)).toBe('collapsed');
  expect(await width(page)).toBe(72);
  await expandButton(page).click();
  expect(await width(page)).toBe(240);
  await page.reload();
  await expect(collapseButton(page)).toBeVisible();
  expect(await width(page)).toBe(240);
});

test('works from the keyboard', async ({ page }) => {
  await open(page);
  await collapseButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(expandButton(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(collapseButton(page)).toBeFocused();
});

for (const viewport of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 2560, height: 1300 }]) {
  test(`Home adapts at ${viewport.width}px: centered, with bunting and scene across the content`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page);
    for (const toggle of [collapseButton, expandButton]) {
      const main = (await page.locator('main').boundingBox())!;
      const stage = (await page.locator('.today-title').boundingBox())!;
      expect(Math.abs(stage.x + stage.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
      const garland = page.locator('.today-garland-wide');
      await expect(garland).toBeVisible();
      await expect.poll(async () => (await garland.boundingBox())?.width).toBe(main.width);
      await expect.poll(async () => (await garland.boundingBox())?.x).toBe(main.x);
      expect((await page.locator('.today-scene-art').boundingBox())!.width).toBe(main.width);
      await noSideScroll(page);
      await toggle(page).click();
    }
  });
}

for (const route of ['#/dictionary', '#/collections', '#/settings', '#/import']) {
  test(`${route} stays centered and without sideways scrolling when collapsed`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await open(page, route);
    await collapseButton(page).click();
    const main = (await page.locator('main').boundingBox())!;
    const screen = (await page.locator('.screen').first().boundingBox())!;
    expect(Math.abs(screen.x + screen.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
    await noSideScroll(page);
  });
}

test('a study session has no menu, collapsed or not', async ({ page }) => {
  await open(page);
  await collapseButton(page).click();
  await open(page, '#/practice');
  await expect(nav(page)).toHaveCount(0);
  expect((await page.locator('main').boundingBox())!.x).toBe(0);
});

test('phones keep the tab bar, even with a collapsed choice saved', async ({ page }) => {
  await open(page);
  await collapseButton(page).click();
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(nav(page).getByRole('button')).toHaveCount(0);
  await expect(nav(page).getByText(t.nav.dictionary)).toBeVisible();
  const box = (await nav(page).boundingBox())!;
  expect(box.width).toBe(390);
  expect(box.y + box.height).toBe(780);
  await noSideScroll(page);
});

test('resetting all data forgets the choice', async ({ page }) => {
  await open(page, '#/settings');
  await collapseButton(page).click();
  await page.getByRole('button', { name: t.settings.reset }).click();
  await page.getByRole('dialog').getByRole('button', { name: t.settings.resetConfirm }).click();
  await expect(page.locator('h1')).toHaveText(t.home.title);
  await expect(collapseButton(page)).toBeVisible();
  expect(await width(page)).toBe(240);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no accessibility problems in ${scheme}, either state`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    expect((await new AxeBuilder({ page }).include('nav').analyze()).violations).toEqual([]);
    await collapseButton(page).click();
    expect((await new AxeBuilder({ page }).include('nav').analyze()).violations).toEqual([]);
  });
}

const positions = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('nav .brand-mark, nav .nav-link .icon')].map((el) => {
      const box = el.getBoundingClientRect();
      return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
    }),
  );

test.describe('stability', () => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    test(`logo and icons stay exactly where they are at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page);
      const before = await positions(page);
      expect(before).toHaveLength(5);
      await collapseButton(page).click();
      expect(await positions(page)).toEqual(before);
      await expandButton(page).click();
      expect(await positions(page)).toEqual(before);
      expect(await nav(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    });
  }

  test('the icons are centered in the collapsed menu', async ({ page }) => {
    await open(page);
    await collapseButton(page).click();
    for (const [x, , w] of await positions(page)) expect(x! + w! / 2).toBe(36);
    const toggle = (await expandButton(page).boundingBox())!;
    expect(toggle.x + toggle.width / 2).toBe(36);
  });

  test('the page keeps its scroll position', async ({ page }) => {
    await open(page, '#/dictionary');
    await page.evaluate(
      (words) =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open('vosli');
          open.onsuccess = () => {
            const tx = open.result.transaction('words', 'readwrite');
            for (const word of words) tx.objectStore('words').put(word);
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
          };
        }),
      Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, identityKey: `W${i}|`, lemma: `W${i}`, article: null, pos: 'other', plural: null, meanings: [{ text: 'x', note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null })),
    );
    await page.reload();
    await expect(page.getByRole('link', { name: 'W59' }).or(page.getByRole('link', { name: 'W1', exact: false })).first()).toBeVisible();
    await page.evaluate(() => scrollTo(0, 800));
    await collapseButton(page).click();
    expect(await page.evaluate(() => scrollY)).toBe(800);
    await expandButton(page).click();
    expect(await page.evaluate(() => scrollY)).toBe(800);
    await noSideScroll(page);
  });
});

test.describe('the control on the logo', () => {
  const opacity = (locator: ReturnType<Page['locator']>) => locator.evaluate((el) => getComputedStyle(el).opacity);

  test('collapsed, it appears on hover and opens the menu', async ({ page }) => {
    await open(page);
    await collapseButton(page).click();
    await page.mouse.move(700, 400);
    await expect.poll(() => opacity(expandButton(page).locator('..').locator('.sidebar-toggle'))).toBe('0');
    await expect.poll(() => opacity(page.locator('.brand-mark'))).toBe('1');
    await page.locator('.brand-row').hover();
    await expect.poll(() => opacity(page.locator('.sidebar-toggle'))).toBe('1');
    await expect.poll(() => opacity(page.locator('.brand-mark'))).toBe('0');
    await page.locator('.brand-row').click();
    expect(await width(page)).toBe(240);
    await expect(collapseButton(page)).toBeVisible();
  });

  test('from the keyboard it shows when reached, with a focus ring', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari skips links and buttons on Tab by default');
    await open(page);
    await collapseButton(page).click();
    await page.mouse.move(700, 400);
    await page.locator('main').focus();
    await nav(page).getByRole('link', { name: t.appName }).focus();
    await page.keyboard.press('Tab');
    await expect(expandButton(page)).toBeFocused();
    await expect.poll(() => opacity(page.locator('.sidebar-toggle'))).toBe('1');
    expect(await page.locator('.sidebar-toggle').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    expect(await width(page)).toBe(240);
  });

  test('expanded, it is simply there', async ({ page }) => {
    await open(page);
    await page.mouse.move(700, 400);
    expect(await opacity(page.locator('.sidebar-toggle'))).toBe('1');
    expect(await opacity(page.locator('.brand-mark'))).toBe('1');
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });

  test('the logo stays, a small mark shows, and a tap opens the menu', async ({ page }) => {
    await open(page);
    await collapseButton(page).tap();
    expect(await width(page)).toBe(72);
    expect(await page.locator('.brand-mark').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await page.locator('.sidebar-toggle').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const box = (await expandButton(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    // Where the logo is drawn, because that is what a finger aims for.
    const logo = (await page.locator('.brand-mark').boundingBox())!;
    await page.touchscreen.tap(logo.x + logo.width / 2, logo.y + logo.height / 2);
    await expect(collapseButton(page)).toBeVisible();
    expect(await width(page)).toBe(240);
  });
});

test.describe('animation', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  const sample = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<{ widths: number[]; icons: string[]; overflow: number[]; duration: number; easing: string }>((resolve) => {
          const nav = document.querySelector('nav')!;
          const icons = () => [...nav.querySelectorAll('.nav-link .icon, .brand-mark')].map((el) => { const box = el.getBoundingClientRect(); return `${Math.round(box.x)},${Math.round(box.y)}`; }).join(' ');
          const result = { widths: [] as number[], icons: [] as string[], overflow: [] as number[], duration: 0, easing: '' };
          (document.querySelector('.sidebar-toggle') as HTMLElement).click();
          const started = performance.now();
          const tick = () => {
            const moving = document.getAnimations().find((a) => (a as CSSTransition).transitionProperty === 'grid-template-columns');
            if (moving && !result.duration) {
              const timing = moving.effect!.getTiming();
              result.duration = Number(timing.duration);
              result.easing = String(timing.easing);
            }
            result.widths.push(nav.getBoundingClientRect().width);
            result.icons.push(icons());
            result.overflow.push(document.documentElement.scrollWidth - innerWidth);
            if (performance.now() - started < 450) requestAnimationFrame(tick);
            else resolve(result);
          };
          requestAnimationFrame(tick);
        }),
    );

  const check = (run: Awaited<ReturnType<typeof sample>>, from: number, to: number) => {
    expect(run.duration).toBe(240);
    expect(run.widths.at(-1)).toBe(to);
    expect(run.widths.some((value) => value > Math.min(from, to) + 10 && value < Math.max(from, to) - 10)).toBe(true);
    const direction = Math.sign(to - from);
    for (let i = 1; i < run.widths.length; i++) expect((run.widths[i]! - run.widths[i - 1]!) * direction).toBeGreaterThanOrEqual(-0.5);
    expect(new Set(run.icons).size).toBe(1);
    expect(Math.max(...run.overflow)).toBeLessThanOrEqual(0);
  };

  test('both directions share one curve and duration, icons hold still, nothing overflows', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const close = await sample(page);
    check(close, 240, 72);
    const reopen = await sample(page);
    check(reopen, 72, 240);
    expect(reopen.easing).toBe(close.easing);
  });

  test('repeated toggling, even mid-flight, ends in the right state', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 5; i++) {
      // Directly on the button: it is moving, and a pointer aimed at where it was could miss.
      await page.locator('.sidebar-toggle').evaluate((button: HTMLElement) => button.click());
      await page.waitForTimeout(60);
    }
    await expect(expandButton(page)).toBeAttached();
    await expect.poll(() => width(page)).toBe(72);
    await noSideScroll(page);
  });

  test('the bunting does not redraw until the width settles', async ({ page }) => {
    await open(page);
    const garland = page.locator('.today-garland-wide');
    const before = await garland.getAttribute('viewBox');
    await page.locator('.sidebar-toggle').click();
    await page.waitForTimeout(100);
    expect(await garland.getAttribute('viewBox')).toBe(before);
    await expect.poll(() => garland.getAttribute('viewBox')).not.toBe(before);
    expect((await garland.boundingBox())!.width).toBe((await page.locator('main').boundingBox())!.width);
  });

  test('Home has no layout shift while toggling', async ({ page }) => {
    await open(page);
    const y = async () => (await page.locator('.today-title').boundingBox())!.y;
    const before = await y();
    await page.locator('.sidebar-toggle').click();
    await page.waitForTimeout(120);
    expect(await y()).toBe(before);
    await page.waitForTimeout(350);
    expect(await y()).toBe(before);
  });

  test('with reduced motion there is nothing to wait for', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await collapseButton(page).click();
    expect(await width(page)).toBe(72);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSTransition).transitionProperty === 'grid-template-columns').length)).toBe(0);
  });
});
