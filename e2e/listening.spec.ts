import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

interface Seed {
  id: string;
  lemma: string;
  article: 'der' | 'die' | 'das' | null;
  meaning: string;
}

// Apfel, Haus and Tür have confirmed recordings that say their spelling. Hochzeit has two that cannot be
// told apart, so none; Quatschwort is not in the dictionary at all. Neither can be asked by ear.
const WORDS: readonly Seed[] = [
  { id: 'apfel', lemma: 'Apfel', article: 'der', meaning: 'elma' },
  { id: 'haus', lemma: 'Haus', article: 'das', meaning: 'ev' },
  { id: 'tuer', lemma: 'Tür', article: 'die', meaning: 'kapı' },
  { id: 'hochzeit', lemma: 'Hochzeit', article: 'die', meaning: 'düğün' },
  { id: 'quatsch', lemma: 'Quatschwort', article: 'das', meaning: 'saçma' },
];
const record = (word: Seed) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: [{ text: word.meaning, note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });
const GROUPS = {
  groups: [
    { id: 'custom', kind: 'custom', name: 'Listem', order: 0, sourceId: null, createdAt: 1 },
    { id: 'silent', kind: 'custom', name: 'Sessiz', order: 1, sourceId: null, createdAt: 1 },
  ],
  groupMembers: [
    { groupId: 'custom', wordId: 'haus', addedAt: 1, importRowId: null },
    { groupId: 'custom', wordId: 'hochzeit', addedAt: 1, importRowId: null },
    { groupId: 'silent', wordId: 'hochzeit', addedAt: 1, importRowId: null },
    { groupId: 'silent', wordId: 'quatsch', addedAt: 1, importRowId: null },
  ],
};

/**
 * Stands in for the browser's audio, so playback is the same on every run. 'end' plays briefly, 'fail'
 * errors, and 'block' refuses to start without a tap, as a browser's autoplay rules can.
 */
function fakeAudio() {
  const fake = { plays: [] as string[], mode: 'end' as 'end' | 'fail' | 'block' };
  (window as unknown as { __audio: typeof fake }).__audio = fake;
  class FakeAudio extends EventTarget {
    src = '';
    currentTime = 0;
    preload = '';
    play() {
      const src = this.src;
      fake.plays.push(src);
      if (fake.mode === 'block') return Promise.reject(new DOMException('needs a tap', 'NotAllowedError'));
      if (fake.mode === 'fail') {
        setTimeout(() => this.dispatchEvent(new Event('error')), 20);
        return Promise.resolve();
      }
      setTimeout(() => this.src === src && this.dispatchEvent(new Event('playing')), 20);
      setTimeout(() => this.src === src && this.dispatchEvent(new Event('ended')), 300);
      return Promise.resolve();
    }
    pause() {}
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

type Fake = { plays: string[]; mode: string };
const plays = async (page: Page) => (await page.evaluate(() => (window as unknown as { __audio: Fake }).__audio.plays)).length;
const setMode = (page: Page, mode: 'end' | 'fail' | 'block') => page.evaluate((value) => ((window as unknown as { __audio: Fake }).__audio.mode = value), mode);
/** The word the last recording was of, read from the file it asked for. */
const lastHeard = async (page: Page): Promise<Seed> => {
  const url = decodeURIComponent((await page.evaluate(() => (window as unknown as { __audio: Fake }).__audio.plays.at(-1))) ?? '');
  const word = WORDS.find((item) => url.includes(`De-${item.lemma}.`));
  if (!word) throw new Error(`No word for ${url}`);
  return word;
};

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

const studyOption = (page: Page, label: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${label}$`) });
const field = (page: Page) => page.getByLabel(t.practice.answerLabel);
const play = (page: Page) => page.getByTestId('listen-play');
const feedback = (page: Page) => page.getByTestId('practice-feedback');
const start = (page: Page) => page.getByRole('button', { name: t.practice.start });

async function openSetup(page: Page) {
  await page.goto('./#/practice');
  await expect(start(page)).toBeVisible();
}

async function startListening(page: Page) {
  await openSetup(page);
  await studyOption(page, t.practice.studies.listen).click();
  await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.countAll}$`) }).click();
  await expect(page.getByTestId('practice-coverage')).toBeVisible();
  await start(page).click();
  await expect(play(page)).toBeEnabled();
}

/** Everything a person or a screen reader could meet on the question, before it is answered. */
const exposed = (page: Page) =>
  page.locator('.practice-session').evaluate((root) => {
    const parts = [root.textContent ?? ''];
    for (const element of root.querySelectorAll('*')) for (const attribute of element.attributes) if (!['class', 'style', 'd', 'viewBox'].includes(attribute.name)) parts.push(attribute.value);
    parts.push(document.title);
    return parts.join(' ');
  });

const noAnswerIn = async (page: Page) => {
  const text = await exposed(page);
  // Whole words only: the meaning ev is also the start of the interface's own Cevabın.
  const whole = (value: string) => new RegExp(`(?<![\\p{L}])${value}(?![\\p{L}])`, 'u');
  for (const word of WORDS) {
    expect(text).not.toMatch(whole(word.lemma));
    expect(text).not.toMatch(whole(word.meaning));
  }
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(fakeAudio);
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await write(page, { words: WORDS.map(record), ...GROUPS });
});

test.describe('setup', () => {
  test('Dinleyerek is the second way to study; it hides the question type and keeps it for typing', async ({ page }) => {
    await openSetup(page);
    await expect(page.locator('input[name="practice-study"]')).toHaveCount(4);
    await expect(page.locator('input[name="practice-study"]').nth(1)).toHaveAccessibleName(t.practice.studies.listen);
    await studyOption(page, t.practice.modes.article).click();
    await studyOption(page, t.practice.studies.listen).click();
    await expect(page.getByText(t.practice.modeLabel, { exact: true })).toHaveCount(0);
    await expect(page.getByText(t.practice.directionLabel, { exact: true })).toHaveCount(0);
    await expect(page.getByText(t.practice.countLabel, { exact: true })).toBeVisible();
    await expect(page.getByText(t.practice.scopeLabel, { exact: true })).toBeVisible();
    // Only Apfel, Haus and Tür can be heard: Hochzeit's recordings are ambiguous and Quatschwort has none.
    await expect(page.getByTestId('practice-coverage')).toHaveText(t.practice.listenCoverage('3'));

    await studyOption(page, t.practice.studies.cards).click();
    await expect(page.getByText(t.practice.directionLabel, { exact: true })).toBeVisible();
    await studyOption(page, t.practice.studies.typed).click();
    await expect(page.locator('input[name="practice-mode"]').nth(2)).toBeChecked();
    await expect(page.getByTestId('practice-coverage')).toHaveCount(0);

    // The choice is remembered on this device.
    await studyOption(page, t.practice.studies.listen).click();
    await page.reload();
    await expect(page.locator('input[name="practice-study"]').nth(1)).toBeChecked();
  });

  test('counts what the chosen words can offer, and cannot start without a recording', async ({ page }) => {
    await openSetup(page);
    await studyOption(page, t.practice.studies.listen).click();
    await page.getByRole('checkbox', { name: /Listem/ }).check();
    await expect(page.getByTestId('practice-coverage')).toHaveText(t.practice.listenCoverage('1'));
    await page.getByRole('checkbox', { name: /Listem/ }).uncheck();
    await page.getByRole('checkbox', { name: /Sessiz/ }).check();
    await expect(page.getByTestId('practice-blocked')).toHaveText(t.practice.noRecordings);
    await expect(start(page)).toBeDisabled();
  });

  test('cannot start while the browser knows it is offline, and can once it is back', async ({ page, context }) => {
    await openSetup(page);
    await studyOption(page, t.practice.studies.listen).click();
    await context.setOffline(true);
    await expect(page.getByTestId('practice-blocked')).toHaveText(t.practice.listenOffline);
    await expect(start(page)).toBeDisabled();
    // Typing needs no connection.
    await studyOption(page, t.practice.studies.typed).click();
    await expect(start(page)).toBeEnabled();
    await studyOption(page, t.practice.studies.listen).click();
    await context.setOffline(false);
    await expect(start(page)).toBeEnabled();
  });
});

test.describe('a listening round', () => {
  test('asks by ear without giving the word away, checks the spelling, and writes nothing', async ({ page }) => {
    await startListening(page);
    await expect(page.getByTestId('practice-cue')).toHaveText(t.practice.listenCue.noun);
    await expect(page.getByTestId('practice-question')).toHaveCount(0);
    await expect(page.getByTestId('speaker')).toHaveCount(0);
    // The first recording waits for a tap.
    expect(await plays(page)).toBe(0);
    await expect(play(page)).toHaveAccessibleName(t.practice.listen);
    await expect(page.getByTestId('practice-announcement')).toHaveText(t.practice.listenCue.noun);
    await noAnswerIn(page);

    await play(page).click();
    expect(await plays(page)).toBe(1);
    await expect(field(page)).toBeFocused();
    await expect(play(page)).toHaveAccessibleName(t.practice.listenAgain);
    const first = await lastHeard(page);
    await noAnswerIn(page);

    // Enter in the empty field hears it again, and answers nothing. While it still plays, it starts over in place.
    await expect(play(page)).toHaveAttribute('data-status', 'idle');
    await page.keyboard.press('Enter');
    await expect.poll(() => plays(page)).toBe(2);
    await expect(feedback(page)).toHaveCount(0);

    // A hint shows letters of the German; hearing it again is not a hint.
    await page.getByRole('button', { name: t.practice.hint }).click();
    await expect(page.getByTestId('practice-hint')).toHaveText(t.practice.hintShown(`${first.lemma[0]}${'•'.repeat([...first.lemma].length - 1)}`));

    // The article can be left out, as a recording does not say it. A wrong one is still wrong.
    await field(page).fill(`${first.article === 'die' ? 'der' : 'die'} ${first.lemma}`);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.reasons.article_wrong);
    await expect(feedback(page)).toContainText(`${first.article} ${first.lemma}`);
    await expect(feedback(page)).toContainText(t.practice.meaning(first.meaning));

    // Moving on plays the next one, with no tap.
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveCount(0);
    await expect.poll(() => plays(page)).toBe(3);
    const second = await lastHeard(page);
    expect(second.id).not.toBe(first.id);
    await noAnswerIn(page);
    await field(page).fill(second.lemma);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveClass(/feedback-correct/);
    await expect(feedback(page)).toContainText(`${second.article} ${second.lemma}`);
    await expect(feedback(page)).toContainText(t.practice.meaning(second.meaning));

    expect(await table(page, 'reviewLogs')).toEqual([]);
    expect(await table(page, 'cards')).toEqual([]);
  });

  test('a browser that will not play without a tap is not a failure', async ({ page }) => {
    await startListening(page);
    await play(page).click();
    await page.getByTestId('practice-reveal').click();
    await setMode(page, 'block');
    await page.getByTestId('practice-action').click();
    await expect(feedback(page)).toHaveCount(0);
    await expect.poll(() => plays(page)).toBe(2);
    await expect(page.getByTestId('listen-failed')).toHaveCount(0);
    await expect(page.getByTestId('pronunciation-status')).toHaveText('');
    await expect(play(page)).toHaveAccessibleName(t.practice.listen);
    await setMode(page, 'end');
    await play(page).click();
    await expect(play(page)).toHaveAccessibleName(t.practice.listenAgain);
  });

  test('a recording that will not play can be tried again or passed over, and is never counted', async ({ page }) => {
    await startListening(page);
    await expect(page.getByTestId('practice-count')).toContainText('0 / 3');
    await setMode(page, 'fail');
    await play(page).click();
    const failed = page.getByTestId('listen-failed');
    await expect(failed).toContainText(t.pronunciation.failed);
    await noAnswerIn(page);
    await failed.getByRole('button', { name: t.practice.retryAudio }).click();
    await expect.poll(() => plays(page)).toBe(2);
    await expect(failed).toBeVisible();
    // Two failures in a row: the connection may be the reason, so ending is offered.
    await expect(failed.getByRole('button', { name: t.practice.endSession })).toBeVisible();
    await failed.getByRole('button', { name: t.practice.skip }).click();
    await expect(failed).toHaveCount(0);
    await expect(page.getByTestId('practice-count')).toContainText('0 / 2');
    await expect(field(page)).toBeFocused();

    await setMode(page, 'end');
    /** Moves on, and waits for the next question's own recording to start. */
    const moveOn = async () => {
      const before = await plays(page);
      await page.getByTestId('practice-action').click();
      await expect(feedback(page)).toHaveCount(0);
      await expect.poll(() => plays(page)).toBeGreaterThan(before);
    };
    for (let i = 0; i < 2; i++) {
      await play(page).click();
      await page.getByTestId('practice-reveal').click();
      await expect(feedback(page)).toHaveClass(/feedback-revealed/);
      await moveOn();
    }
    // Shown answers come back once; the skipped question never does.
    for (let i = 0; i < 2; i++) {
      await expect(page.getByTestId('practice-cue')).toContainText(t.practice.retry);
      await field(page).fill((await lastHeard(page)).lemma);
      await page.keyboard.press('Enter');
      await expect(feedback(page)).toHaveClass(/feedback-correct/);
      if (i === 0) await moveOn();
      else await page.getByTestId('practice-action').click();
    }
    await expect(page.getByTestId('practice-score')).toHaveText(t.practice.firstTry('0', '2'));
    expect(await table(page, 'reviewLogs')).toEqual([]);
  });

  test('a reload keeps the question and its hints, and plays nothing until asked', async ({ page }) => {
    await startListening(page);
    await play(page).click();
    await page.getByTestId('practice-reveal').click();
    await page.getByTestId('practice-action').click();
    await expect.poll(() => plays(page)).toBe(2);
    await page.getByRole('button', { name: t.practice.hint }).click();
    const hint = await page.getByTestId('practice-hint').innerText();
    await page.reload();
    await expect(play(page)).toBeEnabled();
    await expect(page.getByTestId('practice-hint')).toHaveText(hint);
    await expect(page.getByTestId('practice-count')).toContainText('1 / 3');
    await page.waitForTimeout(300);
    expect(await plays(page)).toBe(0);
    await expect(play(page)).toHaveAccessibleName(t.practice.listen);
  });

  test('closing stops the recording and leaves nothing behind', async ({ page }) => {
    await startListening(page);
    await play(page).click();
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect(await table(page, 'reviewLogs')).toEqual([]);
  });
});

test.describe('fit and access', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`setup, question, failure and feedback fit 320px and 200% text with no detectable problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((value) => localStorage.setItem('vosli.theme', value), scheme);
      const scan = async (label: string) => {
        await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label).toBeLessThanOrEqual(0);
      };
      for (const [width, size] of [[320, '16px'], [320, '32px']] as const) {
        await page.setViewportSize({ width, height: 700 });
        await openSetup(page);
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), size);
        await studyOption(page, t.practice.studies.listen).click();
        const options = await page.locator('input[name="practice-study"] + span').evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().width));
        // Four equal options, two to a row or one to a row.
        if (size === '16px') expect(Math.max(...options) - Math.min(...options)).toBeLessThan(2);
        await scan(`${size} setup`);
        await start(page).click();
        await expect(play(page)).toBeEnabled();
        const box = await play(page).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        await scan(`${size} question`);
        await setMode(page, 'fail');
        await play(page).click();
        await expect(page.getByTestId('listen-failed')).toBeVisible();
        await scan(`${size} failure`);
        await setMode(page, 'end');
        await page.getByTestId('practice-reveal').click();
        await scan(`${size} feedback`);
        // Only the layout is under test here: the round is let go without the close dialog.
        await page.evaluate(() => sessionStorage.clear());
        await page.goto('./#/');
      }
    });
  }
});
