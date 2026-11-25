import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { hintsFor } from '../src/core/practice/answers';
import { t } from '../src/i18n/strings';
import { expect, test } from './fixtures';

/**
 * English pronunciation and English Listening. The English recordings list is a stand-in, served in place of the
 * app's own, and the browser's audio is faked: nothing here depends on Wikimedia, and every run hears the same.
 * apple is American, pear and cake British (cake from Lingua Libre), it's American; plum has no recording, and the
 * English also has none, although the German also does.
 */
const RECORDINGS = ['apple\ta=*:u#1.1', 'cake\ta=*:b=LL-Q1860_(eng)-Vealhurl-cake.wav', "it's\ta=*:u", 'pear\ta=*:b', ''].join('\n');
const CREDITS = ['L\t0\tCC BY-SA 4.0\thttps://creativecommons.org/licenses/by-sa/4.0/', 'L\t1\tCC BY-SA 3.0\thttps://creativecommons.org/licenses/by-sa/3.0/', 'A\t0\tVealhurl', 'A\t1\tDvortygirl', ''].join('\n');

const word = (id: string, lemma: string, article: string | null, meaning: string, language: 'de' | 'en') => ({
  id,
  language,
  identityKey: `${lemma}|${article ?? ''}`,
  lemma,
  article,
  pos: article ? 'noun' : 'other',
  plural: null,
  meanings: [{ text: meaning, note: null }],
  senseTag: null,
  searchTokens: [lemma.toLowerCase(), meaning],
  favoritedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
const ENGLISH = [word('en-apple', 'apple', null, 'elma', 'en'), word('en-pear', 'pear', null, 'armut', 'en'), word('en-cake', 'cake', null, 'pasta', 'en'), word('en-its', 'it’s', null, 'o', 'en'), word('en-plum', 'plum', null, 'erik', 'en'), word('en-also', 'also', null, 'ayrıca', 'en')];
const GERMAN = [word('de-apfel', 'Apfel', 'der', 'elma', 'de'), word('de-also', 'also', null, 'yani', 'de')];
const HEARD = ['apple', 'pear', 'cake', 'it’s'];

/** Stands in for the browser's audio. 'end' plays briefly, 'hang' never starts, as a slow connection may not. */
function fakeAudio() {
  const fake = { plays: [] as string[], released: 0, mode: 'end' as 'end' | 'hang' };
  (window as unknown as { __audio: typeof fake }).__audio = fake;
  class FakeAudio extends EventTarget {
    src = '';
    currentTime = 0;
    preload = '';
    play() {
      const src = this.src;
      fake.plays.push(src);
      if (fake.mode === 'end') {
        setTimeout(() => this.src === src && this.dispatchEvent(new Event('playing')), 20);
        setTimeout(() => this.src === src && this.dispatchEvent(new Event('ended')), 300);
      }
      return Promise.resolve();
    }
    pause() {}
    load() {}
    canPlayType() {
      return '';
    }
    removeAttribute(name: string) {
      if (name !== 'src') return;
      if (this.src) fake.released++;
      this.src = '';
    }
  }
  (window as unknown as { Audio: unknown }).Audio = FakeAudio;
}
type Fake = { plays: string[]; released: number; mode: string };
const audio = (page: Page) => page.evaluate(() => (window as unknown as { __audio: Fake }).__audio);
const heard = async (page: Page) => (await audio(page)).plays.map((url) => decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)));

const serve = (body: string) => (route: Route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body });

async function write(page: Page, tables: Record<string, unknown[]>) {
  await page.evaluate(
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
}
const rows = (page: Page, name: string) =>
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

/** Both workspaces filled, English open. */
async function inEnglish(page: Page, hash = '#/') {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await write(page, { words: [...GERMAN, ...ENGLISH], meta: [{ key: 'learningLanguage', value: 'en' }] });
  await page.goto(`./${hash}`);
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
}

const switchTo = async (page: Page, language: 'de' | 'en') => {
  await page.goto('./#/settings');
  await page.getByTestId('workspace-switcher').getByRole('radio', { name: t.lang[language].name }).click();
  await page.getByRole('dialog').getByRole('button', { name: t.workspace.switch }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator(`.today-garland:visible .${language === 'en' ? 'flag-navy' : 'flag-black'}`)).toHaveCount(1);
};
const studyOption = (page: Page, label: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${label}$`) });
const start = (page: Page) => page.getByRole('button', { name: t.practice.start });
const play = (page: Page) => page.getByTestId('listen-play');
const field = (page: Page) => page.getByLabel(t.practice.answerLabel);
const feedback = (page: Page) => page.getByTestId('practice-feedback');

async function startListening(page: Page) {
  await page.goto('./#/practice');
  await expect(start(page)).toBeVisible();
  await studyOption(page, t.practice.studies.listen).click();
  await studyOption(page, t.practice.countAll).click();
  await expect(page.getByTestId('practice-coverage')).toHaveText(t.practice.listenCoverage(HEARD.length));
  await start(page).click();
  await expect(play(page)).toBeEnabled();
}

/** The English word a recording was of, read from the file it asked for. */
const wordOf = (file: string) => HEARD.find((lemma) => file.includes(`-${lemma.replace('’', "'")}.`))!;

test.describe('with English recordings', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeAudio);
    await page.route('**/pronunciation/en/recordings.txt', serve(RECORDINGS));
    await page.route('**/pronunciation/en/credits.txt', serve(CREDITS));
  });

  test('a word page plays its English recording and credits it, American or British', async ({ page }) => {
    await inEnglish(page, '#/dictionary/en-apple');
    await expect(page.locator('h1')).toHaveText('apple');
    const speaker = page.locator('.page-actions').getByTestId('speaker');
    await expect(speaker).toHaveAccessibleName(t.lang.en.listen('apple'));
    await expect(page.getByTestId('audio-credit')).toHaveText(`${t.pronunciation.creditVariety(t.pronunciation.varieties.us)}: Dvortygirl · CC BY-SA 3.0 · ${t.pronunciation.source}`);
    await expect(page.getByTestId('audio-credit').getByRole('link', { name: t.pronunciation.source })).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:En-us-apple.ogg');
    await speaker.click();
    expect(await heard(page)).toEqual(['En-us-apple.ogg.mp3']);

    await page.goto('./#/dictionary/en-cake');
    await expect(page.getByTestId('audio-credit')).toContainText(t.pronunciation.creditVariety(t.pronunciation.varieties.uk));
    await expect(page.getByTestId('audio-credit')).toContainText('Vealhurl');
    await page.locator('.page-actions').getByTestId('speaker').click();
    expect((await heard(page)).at(-1)).toBe('LL-Q1860_(eng)-Vealhurl-cake.wav.mp3');
  });

  test('a word without an English recording has no speaker, even where German has one of the same spelling', async ({ page }) => {
    await inEnglish(page, '#/dictionary/en-also');
    await expect(page.locator('h1')).toHaveText('also');
    await expect(page.locator('.page-actions').getByTestId('speaker')).toHaveCount(0);
    await expect(page.getByTestId('audio-credit')).toHaveCount(0);
    await page.goto('./#/dictionary/en-plum');
    await expect(page.locator('h1')).toHaveText('plum');
    await expect(page.locator('.page-actions').getByTestId('speaker')).toHaveCount(0);
    // The dictionary has speakers on exactly the English words that have recordings, each playing English.
    await page.goto('./#/dictionary');
    await expect(page.getByTestId('speaker')).toHaveCount(HEARD.length);
    for (const speaker of await page.getByTestId('speaker').all()) await speaker.click();
    expect((await heard(page)).every((file) => /^(En-(us|uk)-|LL-Q1860_\(eng\)-)/u.test(file))).toBe(true);

    // German keeps its own: its also plays the German recording.
    await switchTo(page, 'de');
    await page.goto('./#/dictionary/de-also');
    await expect(page.locator('h1')).toHaveText('also');
    await page.locator('.page-actions').getByTestId('speaker').click();
    expect((await heard(page)).at(-1)).toBe('De-also.ogg.mp3');
    await expect(page.locator('.page-actions').getByTestId('speaker')).toHaveAccessibleName(t.lang.de.listen('also'));
  });

  test('Listening is offered for English and asks only words with a recording that says them', async ({ page }) => {
    await inEnglish(page, '#/practice');
    await expect(page.locator('input[name="practice-study"]')).toHaveCount(4);
    await studyOption(page, t.practice.studies.listen).click();
    await expect(page.getByText(t.practice.modeLabel, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('practice-coverage')).toHaveText(t.practice.listenCoverage(HEARD.length));
    // The choice is kept for English, and German keeps its own.
    await page.reload();
    await expect(page.locator('input[name="practice-study"]').nth(1)).toBeChecked();
    await switchTo(page, 'de');
    await page.goto('./#/practice');
    await expect(page.locator('input[name="practice-study"]').nth(0)).toBeChecked();
  });

  test('a listening round plays English, takes the word as heard, gives hints, and writes nothing', async ({ page }) => {
    await inEnglish(page);
    await startListening(page);
    await expect(page.getByTestId('practice-cue')).toHaveText(t.practice.listenCue.word);
    expect((await audio(page)).plays).toHaveLength(0);
    await play(page).click();
    await expect.poll(async () => (await heard(page)).length).toBe(1);
    const first = wordOf((await heard(page))[0]!);
    // Never the word in view, in text or for a screen reader.
    await expect(page.locator('.practice-session')).not.toContainText(first);

    await page.getByRole('button', { name: t.practice.hint }).click();
    const saved = ENGLISH.find((item) => item.lemma === first)!;
    await expect(page.getByTestId('practice-hint')).toHaveText(t.practice.hintShown(hintsFor({ ...saved, language: 'en', article: null }, 'listen').stages[0]!));
    // A capital is a slip worth a note, not a mistake. A straight apostrophe writes it’s.
    await field(page).fill(first.replace('’', "'").toUpperCase());
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveClass(/feedback-correct/);
    await expect(feedback(page)).toContainText(first);

    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await heard(page)).length).toBe(2);
    const second = wordOf((await heard(page))[1]!);
    expect(second).not.toBe(first);
    await field(page).fill(`${second}x`);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).not.toHaveClass(/feedback-correct/);

    expect((await heard(page)).every((file) => !file.startsWith('De-'))).toBe(true);
    expect(await rows(page, 'reviewLogs')).toEqual([]);
    expect(await rows(page, 'cards')).toEqual([]);
  });

  test('a listening round stays with English: German does not reopen it, English does', async ({ page }) => {
    await inEnglish(page);
    await startListening(page);
    await play(page).click();
    await page.getByTestId('practice-reveal').click();
    await expect(feedback(page)).toBeVisible();
    // Leave the round without ending it, then study German.
    await switchTo(page, 'de');
    await page.goto('./#/practice');
    await expect(start(page)).toBeVisible();
    await expect(play(page)).toHaveCount(0);
    await switchTo(page, 'en');
    await page.goto('./#/practice');
    await expect(feedback(page)).toBeVisible();
    await expect(page.getByTestId('practice-count')).toContainText(`1 / ${HEARD.length}`);
  });

  test('switching languages stops an English recording, and a list still loading never answers for German', async ({ page }) => {
    await inEnglish(page, '#/dictionary/en-apple');
    await page.evaluate(() => ((window as unknown as { __audio: Fake }).__audio.mode = 'hang'));
    const header = page.locator('.page-actions').getByTestId('speaker');
    await header.click();
    await expect(header).toHaveAttribute('data-status', 'loading');
    await switchTo(page, 'de');
    expect((await audio(page)).released).toBe(1);

    // English recordings that arrive late, after the switch, are only ever English ones.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.unroute('**/pronunciation/en/recordings.txt');
    await page.route('**/pronunciation/en/recordings.txt', async (route) => {
      await held;
      await serve(RECORDINGS)(route);
    });
    await switchTo(page, 'en');
    await page.goto('./#/dictionary/en-pear');
    await switchTo(page, 'de');
    release();
    await page.goto('./#/dictionary/de-apfel');
    await expect(page.locator('h1')).toHaveText('der Apfel');
    await expect(page.locator('.page-actions').getByTestId('speaker')).toHaveAccessibleName(t.lang.de.listen('der Apfel'));
    await page.evaluate(() => ((window as unknown as { __audio: Fake }).__audio.mode = 'end'));
    await page.locator('.page-actions').getByTestId('speaker').click();
    expect((await heard(page)).at(-1)).toBe('De-Apfel.ogg.mp3');
  });

  test('a restored English backup studies English by ear', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Downloads differ on mobile emulation; covered on desktop');
    await page.goto('./#/settings');
    await expect(page.locator('h1')).toHaveText(t.settings.title);
    const backup = {
      app: 'vosli',
      backupVersion: 1,
      schemaVersion: 2,
      exportedAt: 5,
      tables: { words: ENGLISH, cards: [], reviewLogs: [], groups: [], groupMembers: [], sources: [], importRows: [], meta: [{ key: 'schemaVersion', value: 2 }, { key: 'learningLanguage', value: 'en' }] },
    };
    await page.locator('input[type=file]').setInputFiles({ name: 'vosli-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: t.restore.title }).getByRole('button', { name: t.restore.confirm }).click()]);
    await expect(page.getByRole('status').filter({ hasText: t.restore.done })).toBeVisible();
    await page.goto('./#/practice');
    await studyOption(page, t.practice.studies.listen).click();
    await expect(page.getByTestId('practice-coverage')).toHaveText(t.practice.listenCoverage(HEARD.length));
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`English Listening fits at 320px with 200% text and is accessible, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.emulateMedia({ colorScheme: theme });
      await inEnglish(page);
      await startListening(page);
      await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await play(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await page.goto('./#/dictionary/en-apple');
      await expect(page.getByTestId('audio-credit')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    });
  }
});

test('with no English recording to hear, Listening says so and cannot start', async ({ page }) => {
  await page.addInitScript(fakeAudio);
  await page.route('**/pronunciation/en/recordings.txt', serve(''));
  await inEnglish(page, '#/practice');
  await studyOption(page, t.practice.studies.listen).click();
  await expect(page.getByTestId('practice-blocked')).toHaveText(t.practice.noRecordings);
  await expect(start(page)).toBeDisabled();
  await page.goto('./#/dictionary/en-apple');
  await expect(page.locator('h1')).toHaveText('apple');
  await expect(page.getByTestId('speaker')).toHaveCount(0);
});
