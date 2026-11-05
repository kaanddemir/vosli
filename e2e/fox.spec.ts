import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { daytimeMood } from '../src/core/foxMood';
import { t } from '../src/i18n/strings';

const word = (i: number) => ({ id: `w${i}`, identityKey: `Xq${i}|der`, lemma: `Xq${i}`, article: 'der', pos: 'noun', plural: null, meanings: [{ text: 'x', note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });

/** A day on which the usual, winking face shows. */
const winkingDay = () => {
  const day = new Date(2026, 10, 5, 12, 0);
  while (daytimeMood(day) !== 'mischievous') day.setDate(day.getDate() + 1);
  return day;
};
const curiousDay = () => {
  const day = new Date(2026, 10, 5, 12, 0);
  while (daytimeMood(day) !== 'curious') day.setDate(day.getDate() + 1);
  return day;
};
const NIGHT = new Date(2026, 10, 5, 23, 45);

const open = async (page: Page, time: Date) => {
  await page.clock.setFixedTime(time);
  await page.goto('./#/');
  await expect(fox(page)).toBeVisible();
};
const fox = (page: Page) => page.getByRole('button', { name: t.home.petFox });
const art = (page: Page) => page.locator('.fox');
const lift = (page: Page) => page.locator('.fox-body').evaluate((body) => getComputedStyle(body).transform);
const seed = (page: Page) =>
  page.evaluate(
    (words) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('vosli');
        open.onsuccess = () => {
          const tx = open.result.transaction('words', 'readwrite');
          for (const row of words) tx.objectStore('words').put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    Array.from({ length: 45 }, (_, i) => word(i)),
  );

test.use({ reducedMotion: 'reduce' });

test.describe('identity', () => {
  test('at rest it draws exactly the logo', async ({ page }) => {
    await open(page, winkingDay());
    const different = await art(page).evaluate(async (svg) => {
      const draw = async (markup: string) => {
        const image = new Image();
        image.src = `data:image/svg+xml,${encodeURIComponent(markup)}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0, 512, 512);
        return context.getImageData(0, 0, 512, 512).data;
      };
      const logo = await draw(await (await fetch('./icons/vosli-mark.svg')).text());
      const inline = await draw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${svg.innerHTML}</svg>`);
      let count = 0;
      for (let i = 0; i < logo.length; i += 4) if ([0, 1, 2, 3].some((c) => Math.abs(logo[i + c]! - inline[i + c]!) > 48)) count++;
      return count;
    });
    expect(different).toBeLessThan(30);
  });

  test('a curious day has both eyes open', async ({ page }) => {
    await open(page, curiousDay());
    await expect(art(page)).toHaveAttribute('data-face', 'open');
  });
});

test.describe('petting', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('stays happy and raised while pressed, then returns to its mood', async ({ page }) => {
    await open(page, winkingDay());
    await expect(art(page)).toHaveAttribute('data-face', 'wink');
    const box = (await fox(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(art(page)).toHaveAttribute('data-face', 'happy');
    await expect(art(page)).toHaveAttribute('data-pose', 'raised');
    await page.waitForTimeout(1200);
    await expect(art(page)).toHaveAttribute('data-face', 'happy');
    expect(await lift(page)).not.toBe('none');
    await page.mouse.up();
    await expect(art(page)).toHaveAttribute('data-pose', 'rest');
    await page.mouse.move(0, 0);
    await expect(art(page)).toHaveAttribute('data-face', 'wink');
  });

  test('a quick tap is still seen, and dragging away still lets go', async ({ page }) => {
    await open(page, winkingDay());
    const box = (await fox(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    await expect(art(page)).toHaveAttribute('data-face', 'happy');
    await expect(art(page)).toHaveAttribute('data-pose', 'rest', { timeout: 2000 });
    await page.mouse.down();
    await page.mouse.move(5, 5);
    await expect(art(page)).toHaveAttribute('data-pose', 'raised');
    await page.mouse.up();
    await expect(art(page)).toHaveAttribute('data-pose', 'rest', { timeout: 2000 });
  });

  test('repeated pets vary but never build up', async ({ page }) => {
    await open(page, winkingDay());
    const tilts = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await fox(page).dispatchEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse' }).catch(() => undefined);
      tilts.add((await art(page).getAttribute('data-tilt'))!);
      await fox(page).dispatchEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse' });
    }
    expect([...tilts].sort()).toEqual(['-1', '0', '1']);
    await expect(art(page)).toHaveAttribute('data-pose', 'rest', { timeout: 2000 });
  });

  test('a mouse is noticed once from its side, and forgotten after leaving', async ({ page }) => {
    await open(page, winkingDay());
    const box = (await fox(page).boundingBox())!;
    await page.mouse.move(box.x - 40, box.y + box.height / 2);
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await expect(art(page)).toHaveAttribute('data-noticed', '-1');
    await expect(art(page)).toHaveAttribute('data-face', 'open');
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 4 });
    await expect(art(page)).toHaveAttribute('data-noticed', '-1');
    await page.mouse.move(0, 0);
    await expect(art(page)).toHaveAttribute('data-noticed', '0');
    await expect(art(page)).toHaveAttribute('data-face', 'wink');
  });
});

test.describe('keyboard and touch', () => {
  test('Enter and Space pet it, with a visible focus ring and nothing added to the announcement', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari leaves buttons out of Tab by default');
    await open(page, winkingDay());
    await fox(page).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(fox(page)).toBeFocused();
    expect(await fox(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(art(page)).toHaveAttribute('data-face', 'happy');
    await expect(art(page)).toHaveAttribute('data-face', 'wink', { timeout: 2000 });
    await page.keyboard.press('Space');
    await expect(art(page)).toHaveAttribute('data-face', 'happy');
    await expect(art(page)).toHaveAttribute('data-face', 'wink', { timeout: 2000 });
  });

  test('the drawing stays hidden from assistive technology, and the page has no detectable problems', async ({ page }) => {
    await open(page, NIGHT);
    await expect(page.locator('.today-scene-art')).toHaveAttribute('aria-hidden', 'true');
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a tap pets it and leaves no hover behind', async ({ page }) => {
    await open(page, winkingDay());
    const box = (await fox(page).boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(art(page)).toHaveAttribute('data-face', 'happy');
    await expect(art(page)).toHaveAttribute('data-face', 'wink', { timeout: 2000 });
    await expect(art(page)).toHaveAttribute('data-noticed', '0');
  });
});

test.describe('night', () => {
  test('sleeps behind the ridge; a pet wakes it for the rest of the visit', async ({ page }) => {
    await open(page, NIGHT);
    await expect(art(page)).toHaveAttribute('data-face', 'asleep');
    await expect(art(page)).toHaveAttribute('data-pose', 'asleep');
    await fox(page).click();
    await expect(art(page)).toHaveAttribute('data-pose', 'rest', { timeout: 2000 });
    await expect(art(page)).not.toHaveAttribute('data-face', 'asleep');
    await page.getByRole('link', { name: t.nav.dictionary }).first().click();
    await page.getByRole('link', { name: t.nav.home }).first().click();
    await expect(art(page)).toHaveAttribute('data-pose', 'rest');
    await page.reload();
    await expect(art(page)).toHaveAttribute('data-pose', 'asleep');
  });

  test('stays asleep when a mouse only passes by', async ({ page }) => {
    await open(page, NIGHT);
    await fox(page).hover();
    await expect(art(page)).toHaveAttribute('data-face', 'asleep');
  });
});

test.describe('the wink', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('happens once per visit, a moment after arriving', async ({ page }) => {
    await page.clock.install({ time: winkingDay() });
    await page.goto('./#/');
    await expect(fox(page)).toBeVisible();
    const seen = await page.evaluate(() => {
      (window as unknown as { faces: string[] }).faces = [];
      const svg = document.querySelector('.fox')!;
      new MutationObserver(() => (window as unknown as { faces: string[] }).faces.push(svg.getAttribute('data-face')!)).observe(svg, { attributes: true, attributeFilter: ['data-face'] });
      return svg.getAttribute('data-face');
    });
    expect(seen).toBe('wink');
    await page.clock.runFor(7100);
    await expect.poll(() => page.evaluate(() => (window as unknown as { faces: string[] }).faces)).toContain('open');
    await page.clock.runFor(1000);
    await expect(art(page)).toHaveAttribute('data-face', 'wink');
    const count = await page.evaluate(() => (window as unknown as { faces: string[] }).faces.length);
    await page.clock.runFor(60_000);
    expect(await page.evaluate(() => (window as unknown as { faces: string[] }).faces.length)).toBe(count);
  });
});

test.describe('reduced motion', () => {
  test('the wink and all movement go, and the face still answers', async ({ page }) => {
    await page.clock.install({ time: winkingDay() });
    await page.goto('./#/');
    await expect(fox(page)).toBeVisible();
    await page.clock.runFor(20_000);
    await expect(art(page)).toHaveAttribute('data-face', 'wink');
    const box = (await fox(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(art(page)).toHaveAttribute('data-face', 'happy');
    expect(await lift(page)).toBe('none');
    await page.mouse.up();
  });

  test('still sleeps behind the ridge, because that is a place and not a movement', async ({ page }) => {
    await open(page, NIGHT);
    expect(await lift(page)).not.toBe('none');
  });
});

test.describe('layout', () => {
  const clearOfActions = async (page: Page) => {
    const actions = await page.locator('.today > :not(.today-scene, .today-bunting)').evaluateAll((items) => Math.max(...items.map((item) => item.getBoundingClientRect().bottom)));
    const ears = await page.locator('.fox-ear-left').evaluate((ear) => ear.getBoundingClientRect().top);
    expect(ears).toBeGreaterThan(actions);
  };

  for (const [width, height] of [[1024, 600], [1280, 600], [1920, 600], [1280, 624], [1280, 640], [1280, 660], [1280, 720], [1920, 660], [2560, 600], [3440, 600], [2560, 700], [2560, 800], [3440, 1000], [360, 640], [360, 600], [390, 844], [430, 932], [768, 1024], [1440, 900], [1920, 1080]] as const) {
    test(`${width}×${height}: with the backup reminder, no scrolling and the fox clear of the actions`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page, winkingDay());
      await seed(page);
      await page.reload();
      await expect(page.locator('.today-reminder')).toBeVisible();
      await clearOfActions(page);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      const box = (await fox(page).boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    });
  }

  for (const width of [1280, 1920, 2560, 3440]) {
    test(`${width}×600 without a reminder keeps the garland, does not scroll and clears the actions`, async ({ page }) => {
      await page.setViewportSize({ width, height: 600 });
      await open(page, winkingDay());
      await expect(page.locator('.today-bunting')).toBeVisible();
      await clearOfActions(page);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
    });
  }

  test('a wide, short window stops the fox growing and keeps it centered behind its ridge', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 600 });
    await open(page, winkingDay());
    const [art, main] = await Promise.all([page.locator('.today-scene-art').boundingBox(), page.locator('.app-main').boundingBox()]);
    expect(art!.width).toBeLessThan(main!.width);
    expect(art!.x + art!.width / 2).toBeCloseTo(main!.x + main!.width / 2, 0);
    const [button, head] = await Promise.all([fox(page).boundingBox(), page.locator('.fox-body').boundingBox()]);
    expect(head!.width).toBeLessThanOrEqual(110);
    expect(button!.x + button!.width / 2).toBeCloseTo(head!.x + head!.width / 2, 0);
  });

  test('a tall window scales the drawing with its width, as before', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, winkingDay());
    const art = (await page.locator('.today-scene-art').boundingBox())!;
    expect(art.height).toBeCloseTo(288, 0);
    expect(art.width).toBeCloseTo(1680, 0);
  });

  test('a window too short for the scene has no fox to reach', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.clock.setFixedTime(winkingDay());
    await page.goto('./#/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(fox(page)).toBeHidden();
    await expect(page.locator('.today-scene')).toBeHidden();
  });

  test('the actions above stay reachable around the fox', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page, winkingDay());
    await page.getByRole('main').getByRole('link', { name: t.nav.import }).click();
    await expect(page.locator('h1')).toHaveText(t.import.title);
  });
});
