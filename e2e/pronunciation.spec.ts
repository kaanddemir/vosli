import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { commonsUrls } from '../src/audio/audioIndex';
import { t } from '../src/i18n/strings';

interface Seed {
  id: string;
  lemma: string;
  article: 'der' | 'die' | 'das' | null;
  meaning: string;
  favorite?: boolean;
}

// Apfel, Haus and Tür have confirmed recordings. Hochzeit has two that cannot be told apart, so none.
// Quatschwort is not in the dictionary at all.
const WORDS: readonly Seed[] = [
  { id: 'apfel', lemma: 'Apfel', article: 'der', meaning: 'elma', favorite: true },
  { id: 'haus', lemma: 'Haus', article: 'das', meaning: 'ev' },
  { id: 'tuer', lemma: 'Tür', article: 'die', meaning: 'kapı' },
  { id: 'hochzeit', lemma: 'Hochzeit', article: 'die', meaning: 'düğün' },
  { id: 'quatsch', lemma: 'Quatschwort', article: 'das', meaning: 'saçma' },
];
const record = (word: Seed) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: [{ text: word.meaning, note: null }], senseTag: null, searchTokens: [], favoritedAt: word.favorite ? 1 : null, createdAt: 1, updatedAt: 1, deletedAt: null });
const GROUPS = {
  groups: [
    { id: 'custom', kind: 'custom', name: 'Listem', order: 0, sourceId: null, createdAt: 1 },
    { id: 'lesson', kind: 'lesson', name: 'Ders Bir', order: 1, sourceId: null, createdAt: 1 },
  ],
  groupMembers: [
    { groupId: 'custom', wordId: 'haus', addedAt: 1, importRowId: null },
    { groupId: 'lesson', wordId: 'apfel', addedAt: 1, importRowId: null },
    { groupId: 'lesson', wordId: 'hochzeit', addedAt: 1, importRowId: null },
  ],
};
const MP3 = { apfel: commonsUrls('De-Apfel.ogg').mp3, haus: commonsUrls('De-Haus.ogg').mp3 };

/**
 * Stands in for the browser's audio, so playback is the same on every run and machine. It records what
 * the app asks for. 'end' plays briefly, 'long' keeps playing, 'fail' errors, 'hang' never starts.
 */
function fakeAudio() {
  const fake = { plays: [] as string[], pauses: 0, mode: 'end' as 'end' | 'long' | 'fail' | 'hang' };
  (window as unknown as { __audio: typeof fake }).__audio = fake;
  class FakeAudio extends EventTarget {
    src = '';
    currentTime = 0;
    preload = '';
    play() {
      const src = this.src;
      fake.plays.push(src);
      if (fake.mode === 'hang') return new Promise<void>(() => {});
      if (fake.mode === 'fail') {
        setTimeout(() => this.dispatchEvent(new Event('error')), 20);
        return Promise.resolve();
      }
      setTimeout(() => this.src === src && this.dispatchEvent(new Event('playing')), 20);
      if (fake.mode === 'end') setTimeout(() => this.src === src && this.dispatchEvent(new Event('ended')), 300);
      return Promise.resolve();
    }
    pause() {
      fake.pauses++;
    }
    load() {}
    canPlayType() {
      return '';
    }
    removeAttribute(name: string) {
      if (name === 'src') this.src = '';
    }
  }
  (window as unknown as { Audio: unknown }).Audio = FakeAudio;
}

type Fake = { plays: string[]; pauses: number; mode: string };
const audio = (page: Page) => page.evaluate(() => (window as unknown as { __audio: Fake }).__audio);
const setMode = (page: Page, mode: Fake['mode']) => page.evaluate((value) => ((window as unknown as { __audio: Fake }).__audio.mode = value), mode);

const write = (page: Page, tables: Record<string, unknown[]>) =>
  page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction(Object.keys(data), 'readwrite');
          for (const [name, rows] of Object.entries(data)) for (const row of rows) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    tables,
  );

const table = (page: Page, name: string) =>
  page.evaluate(
    (store) =>
      new Promise<unknown[]>((resolve) => {
        const request = indexedDB.open('vosli');
        request.onsuccess = () => {
          const read = request.result.transaction(store).objectStore(store).getAll();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result as unknown[]);
          };
        };
      }),
    name,
  );

async function seed(page: Page, extra: Record<string, unknown[]> = {}) {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await write(page, { words: WORDS.map(record), ...GROUPS, ...extra });
}

const row = (page: Page, text: string) => page.locator('main .list-item').filter({ hasText: text });
const speaker = (scope: Page | Locator) => scope.getByTestId('speaker');
const listen = (label: string) => t.pronunciation.listen(label);

test.describe('with stand-in audio', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeAudio);
    await seed(page);
  });

  test('Dictionary rows: the speaker sits just before the chevron and only plays, the row still opens the word', async ({ page }) => {
    const wikimedia: string[] = [];
    page.on('request', (request) => request.url().includes('wikimedia.org') && wikimedia.push(request.url()));
    await page.goto('./#/dictionary');
    await expect(speaker(row(page, 'Apfel'))).toBeVisible();
    await expect(speaker(row(page, 'Haus'))).toBeVisible();
    // No reliable recording: no speaker, rather than a wrong one.
    await expect(speaker(row(page, 'Hochzeit'))).toHaveCount(0);
    await expect(speaker(row(page, 'Quatschwort'))).toHaveCount(0);
    expect(wikimedia).toEqual([]);

    const apfel = row(page, 'Apfel');
    await expect(speaker(apfel)).toHaveAccessibleName(listen('der Apfel'));
    const [box, chevron, link, star] = await Promise.all([speaker(apfel).boundingBox(), apfel.locator('.row-chevron').boundingBox(), apfel.locator('.row-link').boundingBox(), apfel.locator('.favorite-mark').boundingBox()]);
    // Immediately left of the chevron, after the text and the favorite star, on one line with them.
    expect(box!.x + box!.width).toBeLessThanOrEqual(chevron!.x + 1);
    expect(chevron!.x - (box!.x + box!.width)).toBeLessThan(16);
    expect(star!.x + star!.width).toBeLessThanOrEqual(box!.x + 12);
    expect(link!.x + link!.width).toBeLessThanOrEqual(star!.x + 1);
    expect(Math.abs(box!.y + box!.height / 2 - (chevron!.y + chevron!.height / 2))).toBeLessThan(2);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // Two separate targets, neither inside the other.
    await expect(apfel.locator('a button, button a, a a')).toHaveCount(0);

    const url = page.url();
    await speaker(apfel).click();
    expect(page.url()).toBe(url);
    expect((await audio(page)).plays).toEqual([MP3.apfel]);
    await expect(speaker(apfel)).toHaveAttribute('data-status', 'playing');
    await expect(speaker(apfel)).toHaveAttribute('data-status', 'idle');

    // The chevron and the rest of the row open the word as before.
    // The chevron is drawn over by the row's link, so a press there lands on the link.
    const arrow = (await apfel.locator('.row-chevron').boundingBox())!;
    await page.mouse.click(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2);
    await expect(page.locator('h1')).toHaveText('der Apfel');
    await page.goBack();
    await row(page, 'Haus').locator('.row-title').click();
    await expect(page.locator('h1')).toHaveText('das Haus');
    expect(await table(page, 'reviewLogs')).toEqual([]);
    expect(await table(page, 'cards')).toEqual([]);
  });

  test('one recording at a time: another word stops the first, the same word starts again', async ({ page }) => {
    await page.goto('./#/dictionary');
    await setMode(page, 'long');
    await speaker(row(page, 'Apfel')).click();
    await expect(speaker(row(page, 'Apfel'))).toHaveAttribute('data-status', 'playing');
    await speaker(row(page, 'Haus')).click();
    await expect(speaker(row(page, 'Haus'))).toHaveAttribute('data-status', 'playing');
    await expect(speaker(row(page, 'Apfel'))).toHaveAttribute('data-status', 'idle');
    await expect(speaker(row(page, 'Apfel')).locator('svg path')).toHaveAttribute('d', /M3\.5 9\.5v5h4l4\.5 4v-13l-4\.5 4zM15\.5 9\.5a3\.5 3\.5 0 0 1 0 5$/u);
    await speaker(row(page, 'Haus')).click();
    const fake = await audio(page);
    // Started again from the beginning, without fetching it a second time.
    expect(fake.plays).toEqual([MP3.apfel, MP3.haus]);
    expect(fake.pauses).toBeGreaterThanOrEqual(1);
  });

  test('a failed or stalled recording recovers quietly and says why', async ({ page, context }) => {
    await page.goto('./#/dictionary');
    await setMode(page, 'fail');
    await speaker(row(page, 'Apfel')).click();
    await expect(speaker(row(page, 'Apfel'))).toHaveAttribute('data-status', 'error');
    await expect(page.getByTestId('pronunciation-status')).toHaveText(t.pronunciation.failed);
    await expect(speaker(row(page, 'Apfel'))).toHaveAttribute('data-status', 'idle', { timeout: 6000 });
    await expect(page.getByTestId('pronunciation-status')).toHaveText('');

    await context.setOffline(true);
    await setMode(page, 'hang');
    await speaker(row(page, 'Haus')).click();
    await expect(speaker(row(page, 'Haus'))).toHaveAttribute('data-status', 'loading');
    await expect(speaker(row(page, 'Haus'))).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
    await expect(page.getByTestId('pronunciation-status')).toHaveText(t.pronunciation.offline);
    await context.setOffline(false);
    // The rest of the screen is untouched.
    await expect(row(page, 'Haus')).toContainText('ev');
  });

  test('covered German has no speaker until it is shown, and choosing words has none', async ({ page }) => {
    await page.goto('./#/dictionary');
    await page.getByRole('button', { name: t.dictionary.hideAnswers }).click();
    // German first: the German is in view, so it can be heard.
    await expect(speaker(row(page, 'Apfel'))).toBeVisible();
    await page.getByRole('button', { name: t.dictionary.direction }).click();
    await expect(speaker(page.locator('main .list'))).toHaveCount(0);
    await page.getByRole('button', { name: t.dictionary.revealGerman('ev') }).click();
    await expect(speaker(row(page, 'ev'))).toHaveAccessibleName(listen('das Haus'));
    await expect(speaker(page.locator('main .list'))).toHaveCount(1);

    await page.getByRole('button', { name: t.common.select, exact: true }).click();
    await expect(speaker(page.locator('main'))).toHaveCount(0);
  });

  test('Collections use the same place: before the chevron, in source collections and custom lists alike', async ({ page }) => {
    await page.goto('./#/collections/lesson');
    const apfel = row(page, 'Apfel');
    const [box, chevron] = await Promise.all([speaker(apfel).boundingBox(), apfel.locator('.row-chevron').boundingBox()]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(chevron!.x + 1);
    await expect(speaker(row(page, 'Hochzeit'))).toHaveCount(0);
    await speaker(apfel).click();
    expect(page.url()).toContain('#/collections/lesson');
    expect((await audio(page)).plays).toEqual([MP3.apfel]);

    await page.goto('./#/collections/custom');
    const haus = row(page, 'Haus');
    const [speakerBox, chevronBox] = await Promise.all([speaker(haus).boundingBox(), haus.locator('.row-chevron').boundingBox()]);
    expect(speakerBox!.x + speakerBox!.width).toBeLessThanOrEqual(chevronBox!.x + 1);
    // No control on the row takes the word out of the list: that is done by selecting.
    await expect(haus.getByRole('button')).toHaveCount(1);
    await speaker(haus).click();
    // Playing never removes the word or leaves the list.
    await expect(haus).toBeVisible();
    expect(page.url()).toContain('#/collections/custom');
  });

  test('Word details: a speaker in the header and the recording credited with working links', async ({ page }) => {
    await page.goto('./#/dictionary/apfel');
    await expect(page.locator('h1')).toHaveText('der Apfel');
    const header = page.locator('.page-actions');
    await expect(speaker(header)).toHaveAccessibleName(listen('der Apfel'));
    const credit = page.getByTestId('audio-credit');
    await expect(credit).toContainText(t.pronunciation.credit);
    await expect(credit).toContainText(/CC BY/u);
    await expect(credit.getByRole('link', { name: t.pronunciation.source })).toHaveAttribute('href', commonsUrls('De-Apfel.ogg').page);
    await expect(credit.getByRole('link', { name: /^CC BY/u })).toHaveAttribute('href', /^https:\/\/creativecommons\.org\/licenses\//u);
    for (const link of await credit.getByRole('link').all()) await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await speaker(header).click();
    expect((await audio(page)).plays).toEqual([MP3.apfel]);

    // Nothing to credit where there is nothing to hear.
    await page.goto('./#/dictionary/hochzeit');
    await expect(page.locator('h1')).toHaveText('die Hochzeit');
    await expect(speaker(page.locator('main'))).toHaveCount(0);
    await expect(page.getByTestId('audio-credit')).toHaveCount(0);
  });

  test('Card Study: the German side has a speaker only when it is in view, and changing cards never plays', async ({ page }) => {
    // Two favorites, both with recordings.
    await write(page, { words: [record({ ...WORDS[1]!, favorite: true })] });
    await page.goto('./#/practice');
    await page.reload();
    const pick = (name: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${name}$`) }).click();
    await pick(t.practice.studies.cards);
    await page.locator('.check-row').filter({ hasText: t.practice.favorites }).click();
    await pick(t.practice.directions.tr_de);
    await page.getByRole('button', { name: t.practice.startCards }).click();
    await page.getByTestId('card-hide').click();
    const card = page.getByTestId('card');
    // Turkish first and covered: the German is not on the page, and neither is a way to hear it.
    await expect(speaker(card)).toHaveCount(0);
    await page.getByTestId('card-reveal').click();
    await expect(speaker(card)).toHaveCount(1);
    await setMode(page, 'long');
    await speaker(card).click();
    await expect(speaker(card)).toHaveAttribute('data-status', 'playing');
    const plays = (await audio(page)).plays.length;
    await page.getByTestId('card-next').click();
    // The next card is covered again, quiet, and nothing started by itself.
    await expect(speaker(card)).toHaveCount(0);
    expect((await audio(page)).plays).toHaveLength(plays);
    await page.getByTestId('card-direction').click();
    // German in front is always in view, so its speaker is there at once.
    await expect(speaker(card)).toHaveCount(1);
    expect((await audio(page)).plays).toHaveLength(plays);
    expect(await table(page, 'reviewLogs')).toEqual([]);
    expect(await table(page, 'cards')).toEqual([]);
  });

  test('Free Practice: no speaker before the answer, one after, and hearing it changes nothing', async ({ page }) => {
    await page.goto('./#/practice');
    await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.modes.tr_de}$`) }).click();
    await page.getByRole('button', { name: t.practice.start }).click();
    const session = page.locator('.practice-session');
    for (let i = 0; i < 3; i++) {
      await expect(page.getByTestId('practice-question')).toBeVisible();
      await expect(speaker(session)).toHaveCount(0);
      // A wrong answer first, then answers shown on request: the speaker comes with either.
      if (i === 0) {
        await page.getByLabel(t.practice.answerLabel).fill('falsch');
        await page.getByTestId('practice-action').click();
      } else {
        await page.getByTestId('practice-reveal').click();
      }
      await expect(page.getByTestId('practice-feedback')).toBeVisible();
      await expect(speaker(page.getByTestId('practice-feedback'))).toHaveCount(0);
      const question = await page.getByTestId('practice-question').innerText();
      const word = WORDS.find((item) => item.meaning === question)!;
      if (word.id === 'hochzeit' || word.id === 'quatsch') await expect(speaker(session)).toHaveCount(0);
      else {
        const logs = await table(page, 'reviewLogs');
        await speaker(session).click();
        // The field keeps focus, so Enter still moves on and a phone keeps its keyboard.
        await expect(page.getByLabel(t.practice.answerLabel)).toBeFocused();
        expect(await table(page, 'reviewLogs')).toEqual(logs);
      }
      await page.getByTestId('practice-action').click();
      await expect(page.getByTestId('practice-feedback')).toHaveCount(0);
    }
    expect(await table(page, 'cards')).toEqual([]);
  });

  test('Smart Review: the speaker comes with the feedback and leaves schedules and logs alone', async ({ page }) => {
    const DAY = 86_400_000;
    const due = Date.now() - DAY;
    const card = { wordId: 'apfel', track: 'tr_de', due, fsrs: { stability: 5, difficulty: 5, dueAt: due, lastReviewAt: due - 5 * DAY, state: 2, scheduleStatus: 'review', reps: 4, lapses: 0, scheduledDays: 5, learningStep: 0 }, schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1' };
    await write(page, { cards: [card] });
    await page.goto('./#/review');
    await page.reload();
    await expect(page.getByTestId('practice-question')).toHaveText('elma');
    await expect(speaker(page.locator('main'))).toHaveCount(0);
    await page.getByLabel(t.practice.answerLabel).fill('der Apfel');
    await page.getByTestId('practice-action').click();
    await expect(page.getByTestId('practice-feedback')).toBeVisible();
    const [cards, logs] = [await table(page, 'cards'), await table(page, 'reviewLogs')];
    expect(logs).toHaveLength(1);
    // In the question card's corner, not in the feedback.
    await expect(speaker(page.locator('.practice-question'))).toHaveCount(1);
    await expect(speaker(page.getByTestId('practice-feedback'))).toHaveCount(0);
    await speaker(page.locator('main')).click();
    await expect(page.getByLabel(t.practice.answerLabel)).toBeFocused();
    expect((await audio(page)).plays).toEqual([MP3.apfel]);
    expect(await table(page, 'cards')).toEqual(cards);
    expect(await table(page, 'reviewLogs')).toEqual(logs);
  });

  for (const width of [320, 375, 390, 430]) {
    test(`the question card's corner speaker never covers the cue or a long question at ${width}px`, async ({ page }) => {
      await write(page, { words: [record({ ...WORDS[0]!, meaning: 'elma, elma ağacının yuvarlak, kırmızı ya da yeşil meyvesi' })] });
      await page.setViewportSize({ width, height: 760 });
      await page.goto('./#/practice');
      await page.reload();
      await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.modes.tr_de}$`) }).click();
      // Apfel is the only favorite, so its long meaning is the question.
      await page.locator('.check-row').filter({ hasText: t.practice.favorites }).click();
      await page.getByRole('button', { name: t.practice.start }).click();
      await expect(page.getByTestId('practice-question')).toHaveText(/^elma, elma ağacının/u);
      const card = page.locator('.practice-question');
      await page.getByTestId('practice-reveal').click();
      await expect(page.getByTestId('practice-feedback')).toBeVisible();
      const corner = speaker(card);
      await expect(corner).toBeVisible();
      // Laid over the corner, not into the card's flow: showing it moves neither the cue nor the question.
      expect(await corner.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
      const placed = await Promise.all([page.getByTestId('practice-cue').boundingBox(), page.getByTestId('practice-question').boundingBox()]);
      await corner.evaluate((element) => ((element as HTMLElement).style.display = 'none'));
      expect(await Promise.all([page.getByTestId('practice-cue').boundingBox(), page.getByTestId('practice-question').boundingBox()])).toEqual(placed);
      await corner.evaluate((element) => ((element as HTMLElement).style.display = ''));
      for (const root of ['16px', '32px']) {
        await page.evaluate((size) => (document.documentElement.style.fontSize = size), root);
        const [box, cardBox, cue, question] = await Promise.all([corner.boundingBox(), card.boundingBox(), page.getByTestId('practice-cue').boundingBox(), page.getByTestId('practice-question').boundingBox()]);
        // Inside the card, at its top right, the icon itself lined up with the card's padding.
        expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
        expect(box!.y).toBeGreaterThanOrEqual(cardBox!.y);
        const icon = (await corner.locator('svg').boundingBox())!;
        const padding = await card.evaluate((element) => parseFloat(getComputedStyle(element).paddingRight) + parseFloat(getComputedStyle(element).borderRightWidth));
        expect(Math.abs(cardBox!.x + cardBox!.width - (icon.x + icon.width) - padding)).toBeLessThan(5);
        expect(Math.abs(icon.y - cardBox!.y - padding)).toBeLessThan(5);
        const overlaps = (a: typeof box, b: typeof box) => a!.x < b!.x + b!.width && b!.x < a!.x + a!.width && a!.y < b!.y + b!.height && b!.y < a!.y + a!.height;
        const cueText = await page.getByTestId('practice-cue').evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rect = range.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        expect(overlaps(box, cueText), `cue at ${root}`).toBe(false);
        expect(overlaps(box, question), `question at ${root}`).toBe(false);
        expect(cue).not.toBeNull();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    });
  }

  test('Settings says where the audio comes from and what a tap sends', async ({ page }) => {
    await page.goto('./#/settings');
    await expect(page.getByTestId('pronunciation-privacy')).toHaveText(t.settings.pronunciationPrivacy);
    await expect(page.getByRole('link', { name: t.settings.pronunciationSource })).toHaveAttribute('href', 'https://commons.wikimedia.org/');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`speakers, states and the credit have no detectable accessibility problems in ${theme}`, async ({ page }) => {
      await page.evaluate((value) => localStorage.setItem('vosli.theme', value), theme);
      await page.goto('./#/dictionary');
      await page.reload();
      await setMode(page, 'long');
      await speaker(row(page, 'Apfel')).click();
      await expect(speaker(row(page, 'Apfel'))).toHaveAttribute('data-status', 'playing');
      // What this feature adds: the rows with their speakers, the header speaker and the credit.
      expect((await new AxeBuilder({ page }).include('main .list').analyze()).violations).toEqual([]);
      await page.goto('./#/dictionary/apfel');
      await expect(page.getByTestId('audio-credit')).toBeVisible();
      expect((await new AxeBuilder({ page }).include('.page-actions').include('[data-testid="audio-credit"]').analyze()).violations).toEqual([]);
    });
  }

  for (const width of [320, 375, 390, 430]) {
    test(`rows keep their shape at ${width}px, and at 200% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const root of ['16px', '32px']) {
        await page.goto('./#/dictionary');
        await page.evaluate((size) => (document.documentElement.style.fontSize = size), root);
        const apfel = row(page, 'Apfel');
        await expect(speaker(apfel)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const [rowBox, box, link, chevron] = await Promise.all([apfel.boundingBox(), speaker(apfel).boundingBox(), apfel.locator('.row-link').boundingBox(), apfel.locator('.row-chevron').boundingBox()]);
        expect(box!.x + box!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
        // Beside the word, or, with large text, on a line of its own below it. Never over it.
        const beside = link!.x + link!.width <= box!.x + 12;
        const below = box!.y + box!.height / 2 >= link!.y + link!.height;
        expect(beside || below).toBe(true);
        // Still just before the chevron.
        expect(box!.x + box!.width).toBeLessThanOrEqual(chevron!.x + 1);
        expect(Math.abs(box!.y + box!.height / 2 - (chevron!.y + chevron!.height / 2))).toBeLessThan(2);
        // The word keeps room to be read: at least half the row.
        expect(link!.width).toBeGreaterThan(rowBox!.width / 2);
      }
    });
  }
});

test('plays a real file through the browser, fetched only on the tap', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Headless WebKit and Firefox have no audio output here');
  // A short silent WAV stands in for the recording; nothing goes to Wikimedia during tests.
  const samples = 4000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  const requested: string[] = [];
  await page.route('https://upload.wikimedia.org/**', (route) => {
    requested.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
  });
  await seed(page);
  await page.goto('./#/dictionary');
  await expect(speaker(row(page, 'Apfel'))).toBeVisible();
  expect(requested).toEqual([]);
  await speaker(row(page, 'Apfel')).click();
  await expect(speaker(row(page, 'Apfel'))).toHaveAttribute('data-status', 'idle', { timeout: 5000 });
  expect(requested[0]).toBe(MP3.apfel);
  await expect(page.getByTestId('pronunciation-status')).toHaveText('');
});
