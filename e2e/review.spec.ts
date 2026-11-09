import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

interface Seed {
  id: string;
  lemma: string;
  article: 'der' | 'die' | 'das' | null;
  meanings: string[];
}

const APFEL: Seed = { id: 'apfel', lemma: 'Apfel', article: 'der', meanings: ['elma'] };
const TUER: Seed = { id: 'tuer', lemma: 'Tür', article: 'die', meanings: ['kapı'] };
const DANKE: Seed = { id: 'danke', lemma: 'danke', article: null, meanings: ['teşekkürler'] };
const FLAGGED: Seed = { id: 'automat', lemma: 'Geldautomat', article: 'das', meanings: ['bankamatik'] };

const toRecord = (word: Seed) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: word.meanings.map((text) => ({ text, note: null })), senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });

const DAY = 86_400_000;
const reviewCard = (wordId: string, track: string, due: number) => ({ wordId, track, due, fsrs: { stability: 5, difficulty: 5, dueAt: due, lastReviewAt: due - 5 * DAY, state: 2, scheduleStatus: 'review', reps: 4, lapses: 0, scheduledDays: 5, learningStep: 0 }, schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1' });
const OVERDUE = () => Date.now() - DAY;
const LATER = () => Date.now() + 30 * DAY;

async function write(page: Page, tables: Record<string, unknown[]>) {
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(Object.keys(data), 'readwrite');
          for (const [table, rows] of Object.entries(data)) for (const row of rows) tx.objectStore(table).put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    tables,
  );
}

async function seed(page: Page, words: readonly Seed[], cards: unknown[] = [], hash = '#/review') {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await write(page, { words: words.map(toRecord), cards });
  await page.goto(`./${hash}`);
  await page.reload();
}

const readTable = <T = Record<string, unknown>>(page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction(name).objectStore(name).getAll();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result as unknown[]);
          };
        };
      }),
    table,
  ) as Promise<T[]>;

interface LogRow { mode: string; grade?: string; hintsUsed: number; wordId: string; track: string; retry?: boolean; typed: string }
interface CardRow { wordId: string; track: string; due: number; fsrs: { reps: number; state: number; dueAt: number; lapses: number } }
const logs = (page: Page) => readTable<LogRow>(page, 'reviewLogs');
const cards = (page: Page) => readTable<CardRow>(page, 'cards');

const field = (page: Page) => page.getByLabel(t.practice.answerLabel);
const action = (page: Page) => page.getByTestId('practice-action');
const feedback = (page: Page) => page.getByTestId('practice-feedback');
const prompt = (page: Page) => page.getByTestId('practice-question');
const cue = (page: Page) => page.getByTestId('practice-cue');
const waiting = (page: Page) => page.getByRole('heading', { level: 1, name: t.review.summaryWaitingTitle });
const homeStatus = (page: Page) => page.locator('.today-status');
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const score = (page: Page) => page.getByTestId('practice-score');

const type = async (page: Page, text: string) => {
  await field(page).fill(text);
  await page.keyboard.press('Enter');
  await expect(feedback(page)).toBeVisible();
};
const next = async (page: Page) => {
  await action(page).click();
  await expect(feedback(page)).toHaveCount(0);
};

test.describe('home', () => {
  test('no vocabulary: nothing to review, and the review page leads to adding words', async ({ page }) => {
    await page.goto('./#/review');
    await page.reload();
    await expect(page.getByText(t.practice.emptyTitle)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: t.nav.import })).toBeVisible();
  });

  test('words never studied are ready to study, not due, and nothing is scheduled by being imported', async ({ page }) => {
    await seed(page, [APFEL, TUER], [], '#/');
    await expect(homeStatus(page)).toHaveText(t.home.freshStatus('2'));
    await expect(page.getByRole('main').locator('.btn-primary')).toHaveText(t.home.smartReview);
    expect(await cards(page)).toEqual([]);
  });

  test('due reviews are counted and open real Smart Review, with Free Practice still beside it', { tag: '@smoke' }, async ({ page }) => {
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('apfel', 'tr_de', OVERDUE())], '#/');
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('2'));
    await expect(page.getByRole('main').getByRole('link', { name: t.home.freePractice })).toBeVisible();
    await page.getByRole('main').locator('.btn-primary').click();
    await expect(prompt(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/review$/);
    await expect(cue(page)).not.toContainText(t.review.newTag);
  });

  test('new questions and due reviews are told apart', async ({ page }) => {
    await seed(page, [APFEL, TUER], [reviewCard('apfel', 'de_tr', OVERDUE())], '#/');
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
    await expect(homeStatus(page)).toHaveText(`${t.home.dueStatus('1')} · ${t.home.freshStatus('1')}`);
  });

  test('a studied library with only new skills left says so', async ({ page }) => {
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', LATER())], '#/');
    await expect(homeStatus(page)).toHaveText(t.home.freshStatus('1'));
  });

  test('all reviews done: Smart Review still opens, and honestly has nothing to ask', async ({ page }) => {
    const later = LATER();
    await seed(page, [APFEL], ['de_tr', 'tr_de', 'article'].map((track) => reviewCard('apfel', track, later)), '#/');
    await expect(homeStatus(page)).toHaveText(t.home.doneStatus);
    await page.getByRole('main').getByRole('link', { name: t.home.smartReview }).click();
    await expect(page.getByText(t.review.emptyTitle)).toBeVisible();
  });

  test('deleted words and invalid cards are not counted', async ({ page }) => {
    await seed(page, [DANKE, APFEL], [reviewCard('danke', 'article', OVERDUE()), reviewCard('gone', 'de_tr', OVERDUE()), reviewCard('danke', 'de_tr', LATER()), reviewCard('danke', 'tr_de', LATER()), ...['de_tr', 'tr_de', 'article'].map((track) => reviewCard('apfel', track, OVERDUE()))], '#/');
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('3'));
    await page.evaluate(() => new Promise<void>((resolve) => {
      const request = indexedDB.open('vosli');
      request.onsuccess = () => {
        const tx = request.result.transaction('words', 'readwrite');
        const store = tx.objectStore('words');
        const read = store.get('apfel');
        read.onsuccess = () => store.put({ ...read.result, deletedAt: 5 });
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    }));
    await page.reload();
    await expect(homeStatus(page)).toHaveText(t.home.doneStatus);
  });
});

test.describe('a session', () => {
  test('a new word: asked, saved with its log, back after the scheduler\'s step, then done', { tag: '@smoke' }, async ({ page }) => {
    await page.clock.install();
    await seed(page, [APFEL]);
    await expect(prompt(page)).toHaveText('der Apfel');
    await expect(cue(page)).toContainText(t.review.newTag);
    await expect(field(page)).toBeFocused();

    await type(page, 'elma');
    await expect(feedback(page)).toContainText(t.practice.correct);
    expect(await logs(page)).toMatchObject([{ mode: 'scheduled', grade: 'good', hintsUsed: 0, wordId: 'apfel', track: 'de_tr', typed: 'elma' }]);
    const [first] = await cards(page);
    expect(first).toMatchObject({ wordId: 'apfel', track: 'de_tr', fsrs: { state: 1, reps: 1 } });

    await next(page);
    await expect(heading(page)).toHaveText(t.review.summaryWaitingTitle);
    await expect(page.getByTestId('review-continue')).toHaveCount(0);
    await expect(prompt(page)).toHaveCount(0);
    expect(await logs(page)).toHaveLength(1);

    // Time alone brings no question: the way on appears, and the learner takes it.
    await page.clock.fastForward('10:01');
    await expect(page.getByTestId('review-continue')).toHaveText(t.review.continueWith('1'));
    await expect(prompt(page)).toHaveCount(0);
    await page.reload();
    await page.getByTestId('review-continue').or(prompt(page)).first().waitFor();
    if (await page.getByTestId('review-continue').count()) await page.getByTestId('review-continue').click();
    await expect(prompt(page)).toHaveText('der Apfel');
    await expect(cue(page)).toContainText(t.practice.retry);
    await type(page, 'elma');
    await expect((await cards(page))[0]).toMatchObject({ fsrs: { state: 2, reps: 2 } });
    expect((await logs(page))[1]).toMatchObject({ retry: true, grade: 'good' });

    await expect(action(page)).toHaveText(t.practice.seeSummary);
    await action(page).click();
    await expect(score(page)).toHaveText(t.practice.firstTry('1', '1'));
    // The word's next skill is ready, so this is a summary with a way on, not the end.
    await expect(heading(page)).toHaveText(t.review.summaryWaitingTitle);
    await expect(page.getByTestId('review-continue')).toBeVisible();
  });

  test('with nothing due, new or waiting, it says it is complete, and practice and leaving remain', async ({ page }) => {
    const later = LATER();
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('apfel', 'tr_de', later), reviewCard('apfel', 'article', later)]);
    await type(page, 'elma');
    await action(page).click();
    await expect(heading(page)).toHaveText(t.review.summaryTitle);
    await expect(page.getByTestId('review-continue')).toHaveCount(0);
    await expect(waiting(page)).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: t.home.freePractice })).toHaveClass(/btn-primary/);
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('a waiting session resumes: leaving and coming back keeps it, and the question is asked once it is due', async ({ page }) => {
    await page.clock.install();
    await seed(page, [APFEL]);
    await type(page, 'elma');
    await next(page);
    await expect(waiting(page)).toBeVisible();
    await page.goto('./#/');
    await expect(heading(page)).toBeVisible();
    await page.goto('./#/review');
    await expect(waiting(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    await page.clock.fastForward('10:01');
    await page.goto('./#/');
    await expect(heading(page)).toBeVisible();
    await page.goto('./#/review');
    await expect(prompt(page)).toHaveText('der Apfel');
    await expect(cue(page)).toContainText(t.practice.retry);
  });

  test('wrong is Again and comes back in about a minute, never straight away', async ({ page }) => {
    await page.clock.install();
    await seed(page, [APFEL, TUER]);
    const wrongWord = await prompt(page).innerText();
    await type(page, 'bilmem');
    expect((await logs(page))[0]).toMatchObject({ grade: 'again' });
    await next(page);
    expect(await prompt(page).innerText()).not.toBe(wrongWord);
    await field(page).fill(wrongWord.includes('Apfel') ? 'kapı' : 'elma');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toBeVisible();
    await next(page);
    await expect(waiting(page)).toBeVisible();
    await page.clock.fastForward('01:01');
    await page.getByTestId('review-continue').click();
    await expect(prompt(page)).toHaveText(wrongWord);
  });

  test('showing the answer is Again, once, even when pressed twice, and whatever was typed is ignored', async ({ page }) => {
    await seed(page, [APFEL]);
    await field(page).fill('yarım');
    await page.getByTestId('practice-reveal').dblclick();
    await expect(feedback(page)).toContainText(t.practice.revealed);
    await expect(page.getByTestId('practice-answer-shown')).toContainText('elma');
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
    expect(await logs(page)).toHaveLength(1);
    expect((await logs(page))[0]).toMatchObject({ grade: 'again', typed: '' });
    await expect((await cards(page))[0]).toMatchObject({ fsrs: { state: 1, reps: 1 } });
  });

  test('a hint makes a right answer Hard, and a reload cannot wipe the hint', async ({ page }) => {
    await seed(page, [APFEL]);
    await page.getByRole('button', { name: t.practice.hint }).click();
    await expect(page.getByTestId('practice-hint')).toHaveText(t.practice.hintShown('e•••'));
    await page.reload();
    await expect(page.getByTestId('practice-hint')).toBeVisible();
    await type(page, 'elma');
    await expect(feedback(page)).toContainText(t.practice.correctHinted);
    expect((await logs(page))[0]).toMatchObject({ grade: 'hard', hintsUsed: 1 });
  });

  test('close answers are not made easier: a missing umlaut is Again', async ({ page }) => {
    const later = LATER();
    await seed(page, [TUER], [reviewCard('tuer', 'de_tr', later), reviewCard('tuer', 'article', later), { ...reviewCard('tuer', 'tr_de', OVERDUE()) }]);
    await expect(prompt(page)).toHaveText('kapı');
    await type(page, 'die Tur');
    await expect(feedback(page)).toContainText(t.practice.reasons.transliteration);
    expect((await logs(page))[0]).toMatchObject({ grade: 'again' });
    expect((await cards(page)).find((card) => card.track === 'tr_de')).toMatchObject({ fsrs: { state: 3, lapses: 1 } });
  });

  test('each skill is its own card: article questions use the article buttons', async ({ page }) => {
    const later = LATER();
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', later), reviewCard('apfel', 'tr_de', later), reviewCard('apfel', 'article', OVERDUE())]);
    await expect(cue(page)).toContainText(t.practice.cue.article);
    await page.getByRole('button', { name: 'der', exact: true }).click();
    await expect(feedback(page)).toContainText(t.practice.correct);
    const rows = await cards(page);
    expect(rows.find((card) => card.track === 'article')!.due).toBeGreaterThan(Date.now());
    expect(rows.find((card) => card.track === 'de_tr')!.due).toBe(later);
    expect(rows.find((card) => card.track === 'tr_de')!.due).toBe(later);
  });

  test('German letters go into the answer with no focus lost', async ({ page }) => {
    const later = LATER();
    await seed(page, [TUER], [reviewCard('tuer', 'de_tr', later), reviewCard('tuer', 'article', later), reviewCard('tuer', 'tr_de', OVERDUE())]);
    await field(page).fill('die T');
    await page.getByRole('button', { name: t.practice.insert('ü') }).click();
    await expect(field(page)).toHaveValue('die Tü');
    await expect(field(page)).toBeFocused();
  });

  test('siblings wait for the next session, and it can follow at once with no quota', async ({ page }) => {
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('apfel', 'tr_de', OVERDUE())]);
    await expect(page.getByTestId('practice-count')).toContainText('0 / 1');
    await type(page, (await cue(page).innerText()).includes(t.practice.cue.de_tr) ? 'elma' : 'der Apfel');
    await action(page).click();
    await page.getByTestId('review-continue').click();
    await expect(prompt(page)).toBeVisible();
    await type(page, (await cue(page).innerText()).includes(t.practice.cue.de_tr) ? 'elma' : 'der Apfel');
    expect(await logs(page)).toHaveLength(2);
  });

  test('closing early still offers the new words left, and it disappears once none can be asked', async ({ page }) => {
    await seed(page, [APFEL, TUER]);
    const answerShown = async () => type(page, (await prompt(page).innerText()).includes('Apfel') ? 'elma' : 'kapı');
    await answerShown();
    await next(page).catch(() => undefined);
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page.getByTestId('review-continue')).toHaveText(t.review.continueWith('1'));
    await page.getByTestId('review-continue').click();
    await expect(prompt(page)).toBeVisible();
    await answerShown();
    await next(page);
    await expect(heading(page)).toHaveText(t.review.summaryWaitingTitle);
    await expect(page.getByTestId('review-continue')).toHaveCount(0);
    expect(await logs(page)).toHaveLength(2);
  });

  test('a large library gets a finite session with a way to continue', async ({ page }) => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `w${i}`, lemma: `Xqzw${i}`, article: null, meanings: [`anlam${i}`] }));
    await seed(page, many);
    await expect(page.getByTestId('practice-count')).toContainText('0 / 20');
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect(await cards(page)).toEqual([]);
  });
});

test.describe('safety', () => {
  test('double presses schedule one answer', async ({ page }) => {
    await seed(page, [APFEL, TUER]);
    await field(page).fill('elma');
    await page.getByTestId('practice-action').dblclick();
    await expect(feedback(page)).toBeVisible();
    await field(page).press('Enter');
    expect(await logs(page)).toHaveLength(1);
  });

  test('held Enter answers once and does not skip the feedback', async ({ page }) => {
    await seed(page, [APFEL, TUER]);
    await field(page).fill('x');
    // Further downs with no up are what a held key sends: they arrive with event.repeat set.
    await page.keyboard.down('Enter');
    await expect(feedback(page)).toBeVisible();
    // Past the pause after answering, so only the check for repeats is left to stop it.
    await page.waitForTimeout(450);
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(feedback(page)).toBeVisible();
    expect(await logs(page)).toHaveLength(1);
  });

  test('a reload on the feedback keeps it and adds nothing', async ({ page }) => {
    await seed(page, [APFEL, TUER]);
    const asked = await prompt(page).innerText();
    await type(page, 'bilmem');
    const before = await cards(page);
    await page.reload();
    await expect(feedback(page)).toBeVisible();
    await expect(prompt(page)).toHaveText(asked);
    await expect(field(page)).toHaveValue('bilmem');
    expect(await logs(page)).toHaveLength(1);
    expect(await cards(page)).toEqual(before);
  });

  test('coming back later resumes the session in its place, with earlier answers kept', async ({ page }) => {
    await seed(page, [APFEL, TUER]);
    await type(page, 'bilmem');
    await next(page);
    await page.goto('./#/');
    await expect(heading(page)).toBeVisible();
    await page.goto('./#/review');
    await expect(page.getByTestId('practice-count')).toContainText('1 / 2');
    expect(await logs(page)).toHaveLength(1);
  });

  test('closing shows what was done and saved, and the card keeps its schedule', async ({ page }) => {
    await seed(page, [APFEL, TUER]);
    await type(page, 'bilmem');
    await next(page);
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(score(page)).toHaveText(t.practice.firstTry('0', '1'));
    await expect(heading(page)).toHaveText(t.review.summaryWaitingTitle);
    await expect(waiting(page)).toBeVisible();
    expect(await cards(page)).toHaveLength(1);
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('leaving a finished summary means the next visit starts fresh, while a reload keeps it', async ({ page }) => {
    await seed(page, [APFEL, TUER], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('tuer', 'de_tr', LATER()), reviewCard('tuer', 'tr_de', LATER()), reviewCard('tuer', 'article', LATER())]);
    await type(page, 'elma');
    await action(page).click();
    await expect(score(page)).toBeVisible();
    await page.reload();
    await expect(score(page)).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: t.home.freePractice }).click();
    await expect(heading(page)).toHaveText(t.practice.title);
    await page.goto('./#/review');
    await expect(prompt(page)).toBeVisible();
    await expect(score(page)).toHaveCount(0);
  });

  test('continuing keeps the new session through a reload', async ({ page }) => {
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('apfel', 'tr_de', OVERDUE())]);
    await type(page, (await cue(page).innerText()).includes(t.practice.cue.de_tr) ? 'elma' : 'der Apfel');
    await action(page).click();
    await page.getByTestId('review-continue').click();
    await expect(prompt(page)).toBeVisible();
    const asked = await prompt(page).innerText();
    await page.getByRole('button', { name: t.practice.hint }).click();
    await page.reload();
    await expect(prompt(page)).toHaveText(asked);
    await expect(page.getByTestId('practice-hint')).toBeVisible();
  });

  test('a question already answered in another tab is not asked again', async ({ page, context }) => {
    const due = OVERDUE();
    await seed(page, [APFEL, TUER], [reviewCard('apfel', 'de_tr', due), reviewCard('tuer', 'de_tr', due)]);
    const first = await prompt(page).innerText();
    const second = await context.newPage();
    await second.goto('./#/review');
    await expect(prompt(second)).toHaveText(first);
    const answerOf = (text: string) => (text.includes('Apfel') ? 'elma' : 'kapı');
    await type(second, answerOf(first));
    const otherWord = await (async () => {
      await next(second);
      return prompt(second).innerText();
    })();
    await type(second, answerOf(otherWord));
    expect(await logs(page)).toHaveLength(2);
    const before = await cards(page);

    // This tab still shows the first question from before those answers.
    await field(page).fill(answerOf(first));
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('practice-save-message')).toHaveText(t.review.conflict);
    expect(await logs(page)).toHaveLength(2);
    expect(await cards(page)).toEqual(before);

    // And the second card, answered there, is passed over here.
    await action(page).click();
    await expect(prompt(page)).toHaveCount(0);
    expect(await logs(page)).toHaveLength(2);
  });

  test('a word deleted during the session is passed over', async ({ page }) => {
    await seed(page, [APFEL, TUER]);
    const asked = await prompt(page).innerText();
    await type(page, 'bilmem');
    const other = asked.includes('Apfel') ? TUER : APFEL;
    await write(page, { words: [{ ...toRecord(other), deletedAt: 5 }] });
    await next(page);
    await expect(waiting(page)).toBeVisible();
    expect(await logs(page)).toHaveLength(1);
  });

  test('an answer to a word edited in another tab does not count', async ({ page }) => {
    await seed(page, [APFEL]);
    await expect(prompt(page)).toBeVisible();
    await write(page, { words: [{ ...toRecord(APFEL), meanings: [{ text: 'alma', note: null }] }] });
    await type(page, 'elma');
    await expect(page.getByTestId('practice-save-message')).toHaveText(t.review.conflict);
    expect(await logs(page)).toEqual([]);
    expect(await cards(page)).toEqual([]);
  });

  test('editing an article through the app resets the skills it affects', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Same data path, covered at the database level as well');
    const later = LATER();
    await seed(page, [APFEL], ['de_tr', 'tr_de', 'article'].map((track) => reviewCard('apfel', track, later)), '#/dictionary/apfel/edit');
    await page.getByRole('radio', { name: 'die', exact: true }).check();
    await page.getByRole('button', { name: t.common.save }).click();
    await expect(page).not.toHaveURL(/edit$/);
    await expect.poll(async () => (await cards(page)).map((card) => card.track).sort()).toEqual(['de_tr']);
    expect((await cards(page)).every((card) => card.due === later)).toBe(true);
  });

  test('restoring a backup brings the schedule back and a due card is asked', { tag: '@smoke' }, async ({ page }) => {
    const due = OVERDUE();
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', due)], '#/');
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
    const backup = { app: 'vosli', backupVersion: 1, schemaVersion: 1, exportedAt: 1 };
    const tables = { words: [toRecord(APFEL)], cards: [reviewCard('apfel', 'de_tr', due)], reviewLogs: [], groups: [], groupMembers: [], sources: [], importRows: [], meta: [] };
    await write(page, { cards: [{ ...reviewCard('apfel', 'de_tr', LATER()) }] });
    await page.goto('./#/settings');
    await page.locator('input[type="file"]').setInputFiles({ name: 'yedek.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup, tables })) });
    await page.getByRole('button', { name: t.restore.confirm, exact: true }).click();
    await expect.poll(async () => (await cards(page))[0]?.due).toBe(due);
    await page.goto('./#/');
    await page.reload();
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
  });
});

test('the answer can be shown by keyboard alone, and Enter then moves on', async ({ page, isMobile, browserName }) => {
  test.skip(isMobile || browserName === 'webkit', 'Tab order needs a keyboard, and Safari skips buttons by default');
  await seed(page, [APFEL, TUER]);
  await expect(field(page)).toBeFocused();
  const reveal = page.getByTestId('practice-reveal');
  for (let i = 0; i < 8 && !(await reveal.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(reveal).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(feedback(page)).toContainText(t.practice.revealed);
  expect(await logs(page)).toHaveLength(1);
});

test.describe('deleting a word', () => {
  test('from its page: the warning is exact, and every trace of it goes', async ({ page }) => {
    await seed(page, [APFEL, TUER], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('tuer', 'de_tr', OVERDUE())], '#/dictionary/apfel');
    await write(page, { reviewLogs: [{ mode: 'practice', wordId: 'apfel', track: 'de_tr', at: 1, typed: 'elma', result: 'correct', hintsUsed: 0 }, { mode: 'practice', wordId: 'tuer', track: 'de_tr', at: 2, typed: 'kapı', result: 'correct', hintsUsed: 0 }] });
    await page.getByRole('button', { name: t.dictionary.deleteWord }).click();
    await expect(page.getByRole('dialog')).toContainText('Bu kelime ve öğrenme geçmişi kalıcı olarak silinecek. Bu işlem geri alınamaz.');
    await page.getByRole('dialog').getByRole('button', { name: t.common.delete }).click();
    await expect(heading(page)).toHaveText(t.dictionary.title);
    expect((await readTable<{ id: string }>(page, 'words')).map((word) => word.id)).toEqual(['tuer']);
    expect((await cards(page)).map((card) => card.wordId)).toEqual(['tuer']);
    expect((await logs(page)).map((log) => log.wordId)).toEqual(['tuer']);
  });

  test('while its question is on screen in Smart Review: the answer does not count and nothing comes back', async ({ page }) => {
    await seed(page, [APFEL]);
    await expect(prompt(page)).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => {
      const request = indexedDB.open('vosli');
      request.onsuccess = () => {
        const tx = request.result.transaction('words', 'readwrite');
        tx.objectStore('words').delete('apfel');
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    }));
    await type(page, 'elma');
    await expect(page.getByTestId('practice-save-message')).toHaveText(t.review.conflict);
    expect(await cards(page)).toEqual([]);
    expect(await logs(page)).toEqual([]);
  });

  test('while its question is on screen in Free Practice: no history is left behind and a backup stays valid', async ({ page }) => {
    await seed(page, [APFEL, TUER], [], '#/practice');
    await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.modes.de_tr}$`) }).click();
    await page.getByRole('button', { name: t.practice.start }).click();
    const asked = await prompt(page).innerText();
    const id = asked.includes('Apfel') ? 'apfel' : 'tuer';
    await page.evaluate((word) => new Promise<void>((resolve) => {
      const request = indexedDB.open('vosli');
      request.onsuccess = () => {
        const tx = request.result.transaction('words', 'readwrite');
        tx.objectStore('words').delete(word);
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    }), id);
    await type(page, 'x');
    await expect.poll(async () => (await logs(page)).filter((log) => log.wordId === id)).toEqual([]);
    await next(page);
    await expect(prompt(page)).not.toHaveText(asked);
  });
});

test.describe('editing a word', () => {
  const later = () => ['de_tr', 'tr_de', 'article'].map((track) => reviewCard('apfel', track, LATER()));

  test('says beforehand when progress would start over, and only then', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Same form');
    await seed(page, [APFEL], later(), '#/dictionary/apfel/edit');
    const note = page.getByTestId('word-reset-note');
    const turkish = page.locator('#word-turkish');
    await expect(turkish).toHaveValue('elma');
    await expect(note).toHaveCount(0);
    await turkish.fill('elma, alma');
    await expect(note).toHaveCount(0);
    await turkish.fill('armut');
    await expect(note).toHaveText(t.wordForm.resetNote('2'));
    await turkish.fill('elma');
    await page.getByRole('radio', { name: 'die', exact: true }).check();
    await expect(note).toHaveText(t.wordForm.resetNote('2'));
  });

  test('removing one of two meanings keeps every card; removing all resets only the language skills', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Same form');
    const two: Seed = { ...APFEL, meanings: ['elma', 'alma'] };
    await seed(page, [two], later(), '#/dictionary/apfel/edit');
    const before = await cards(page);
    const note = page.getByTestId('word-reset-note');
    const turkish = page.locator('#word-turkish');
    await turkish.fill('alma');
    await expect(note).toHaveCount(0);
    await page.getByRole('button', { name: t.common.save }).click();
    await expect(page).not.toHaveURL(/edit/);
    await expect.poll(() => readTable<{ id: string; meanings: { text: string }[] }>(page, 'words').then((rows) => rows[0]!.meanings.map((meaning) => meaning.text))).toEqual(['alma']);
    expect(await cards(page)).toEqual(before);

    await page.goto('./#/dictionary/apfel/edit');
    await turkish.fill('armut');
    await expect(note).toHaveText(t.wordForm.resetNote('2'));
    await page.getByRole('button', { name: t.common.save }).click();
    await expect.poll(async () => (await cards(page)).map((card) => card.track)).toEqual(['article']);
    expect((await cards(page))[0]).toEqual(before.find((card) => card.track === 'article'));
  });

  test('during a session: a card whose answer changed does not come back with its old schedule', async ({ page }) => {
    await page.clock.install();
    await seed(page, [APFEL]);
    await type(page, 'elma');
    await next(page);
    await expect(waiting(page)).toBeVisible();
    await write(page, { words: [{ ...toRecord(APFEL), meanings: [{ text: 'armut', note: null }] }] });
    await page.evaluate(() => new Promise<void>((resolve) => {
      const request = indexedDB.open('vosli');
      request.onsuccess = () => {
        const tx = request.result.transaction('cards', 'readwrite');
        tx.objectStore('cards').clear();
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    }));
    await page.clock.fastForward('10:01');
    await page.reload();
    await expect(prompt(page)).toHaveCount(0);
    await expect(score(page)).toHaveText(t.practice.firstTry('1', '1'));
  });
});

test.describe('home without waiting', () => {
  test('a stored result for the same words shows the number with no dictionary at all', async ({ page }) => {
    await seed(page, [FLAGGED, APFEL], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('automat', 'de_tr', OVERDUE())], '#/');
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
    await page.route('**/dictionary/*.txt', (route) => route.abort());
    await page.reload();
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
  });

  test('while warnings are unknown it states no number, then the right one', async ({ page }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/dictionary/*.txt', async (route) => {
      await gate;
      await route.continue();
    });
    await seed(page, [FLAGGED, APFEL], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('automat', 'de_tr', OVERDUE())], '#/');
    await expect(page.getByRole('main').locator('.btn-primary')).toHaveText(t.home.smartReview);
    await expect(page.getByRole('main')).toContainText(t.home.wordCount('2'));
    await expect(homeStatus(page)).toBeEmpty();
    release();
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
  });

  test('if the dictionary cannot load, the number matches what a session would ask', async ({ page }) => {
    await page.route('**/dictionary/*.txt', (route) => route.abort());
    await seed(page, [FLAGGED, APFEL], [reviewCard('apfel', 'de_tr', OVERDUE()), reviewCard('automat', 'de_tr', OVERDUE())], '#/');
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('2'));
  });

  test('a stored result stops applying when a word changes', async ({ page }) => {
    await seed(page, [FLAGGED], [reviewCard('automat', 'de_tr', OVERDUE())], '#/');
    await expect(homeStatus(page)).toHaveText(t.home.flaggedStatus('1'));
    await write(page, { words: [{ ...toRecord(FLAGGED), article: 'der', identityKey: 'Geldautomat|der' }] });
    await page.reload();
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
  });
});

test.describe('free practice stays apart', () => {
  test('practice works with nothing due and changes no card, right or wrong', async ({ page }) => {
    const later = LATER();
    const seeded = ['de_tr', 'tr_de', 'article'].map((track) => reviewCard('apfel', track, later));
    await seed(page, [APFEL], seeded, '#/');
    await expect(homeStatus(page)).toHaveText(t.home.doneStatus);
    await page.getByRole('main').getByRole('link', { name: t.home.freePractice }).click();
    await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.modes.de_tr}$`) }).click();
    await page.getByRole('button', { name: t.practice.start }).click();
    const before = await cards(page);
    await type(page, 'elma');
    await next(page).catch(() => undefined);
    expect(await cards(page)).toEqual(before);
    expect((await logs(page)).every((log) => log.mode === 'practice')).toBe(true);
    expect((await logs(page)).length).toBeGreaterThan(0);
  });

  test('practising a due card leaves it due', async ({ page }) => {
    const due = OVERDUE();
    await seed(page, [APFEL], [reviewCard('apfel', 'de_tr', due)], '#/practice');
    await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.modes.de_tr}$`) }).click();
    await page.getByRole('button', { name: t.practice.start }).click();
    await type(page, 'elma');
    await page.goto('./#/');
    await page.reload();
    await expect(homeStatus(page)).toContainText(t.home.dueStatus('1'));
    expect((await cards(page))[0]!.due).toBe(due);
  });
});

test.describe('dictionary warnings', () => {
  test('held back by default, can be opened to fix, and can be included', async ({ page }) => {
    await seed(page, [FLAGGED, APFEL]);
    await expect(page.getByTestId('practice-flagged')).toContainText(t.practice.flaggedCount('1'));
    await expect(page.getByTestId('review-ready')).toHaveText(t.review.ready('1'));
    await page.getByRole('button', { name: t.practice.reviewFlagged }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: /Geldautomat/ })).toHaveAttribute('href', /automat\/edit/);
    await page.getByRole('dialog').getByRole('button', { name: t.common.close }).click();
    await page.getByRole('checkbox', { name: t.practice.includeFlagged }).check();
    await expect(page.getByTestId('review-ready')).toHaveText(t.review.ready('2'));
    await page.getByRole('checkbox', { name: t.practice.includeFlagged }).uncheck();
    await page.getByRole('button', { name: t.practice.start }).click();
    await expect(prompt(page)).toHaveText('der Apfel');
  });

  test('when included, a disputed article is not presented as fact', async ({ page }) => {
    await seed(page, [FLAGGED]);
    await page.getByRole('checkbox', { name: t.practice.includeFlagged }).check();
    await page.getByRole('button', { name: t.practice.start }).click();
    await expect(prompt(page)).toHaveText('Geldautomat');
    await type(page, 'bankamatik');
    await expect(page.getByRole('button', { name: t.practice.cautionLabel })).toBeVisible();
  });

  test('home says when only warned words are left, rather than calling it done silently', async ({ page }) => {
    await seed(page, [FLAGGED], [], '#/');
    await expect(homeStatus(page)).toHaveText(t.home.flaggedStatus('1'));
    await page.getByRole('main').getByRole('link', { name: t.home.smartReview }).click();
    await expect(page.getByTestId('practice-flagged')).toBeVisible();
  });
});

test.describe('a dictionary request that fails once', () => {
  // A service worker would answer before the route.
  test.use({ serviceWorkers: 'block' });

  test('still holds back warned words, as after a reload in Safari', async ({ page }) => {
    let failed = false;
    await page.route('**/dictionary/lemmas.txt', async (route) => {
      if (failed) return route.continue();
      failed = true;
      return route.abort();
    });
    await seed(page, [FLAGGED, APFEL]);
    await expect(page.getByTestId('practice-flagged')).toContainText(t.practice.flaggedCount('1'), { timeout: 15_000 });
    expect(failed).toBe(true);
  });
});

test('works offline once the app has been opened', async ({ page, context, isMobile, browserName }) => {
  test.skip(isMobile, 'Covered on desktop');
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot run service workers offline here');
  await seed(page, [APFEL], [], '#/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.goto('./#/review');
  await page.reload();
  await type(page, 'elma');
  expect(await logs(page)).toHaveLength(1);
  // Free Practice, and a backup, need no connection either.
  await page.goto('./#/practice');
  await page.locator('.segmented label').filter({ hasText: new RegExp(`^${t.practice.modes.de_tr}$`) }).click();
  await page.getByRole('button', { name: t.practice.start }).click();
  await type(page, 'elma');
  expect(await logs(page)).toHaveLength(2);
  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: t.settings.download }).click();
  await download;
  await context.setOffline(false);
});

test.describe('fit and access', () => {
  const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

  for (const [width, height, rootPx] of [[320, 568, 16], [320, 568, 32], [390, 844, 16], [844, 390, 16], [667, 375, 16], [1280, 800, 16]] as const) {
    test(`every state fits at ${width}x${height}, ${rootPx}px text`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
      await seed(page, [APFEL]);
      await expect(prompt(page)).toBeVisible();
      expect(await overflow(page)).toBe(false);
      await expect(action(page)).toBeInViewport();
      await type(page, 'elma');
      expect(await overflow(page)).toBe(false);
      await expect(action(page)).toBeInViewport();
      await next(page);
      await expect(waiting(page)).toBeVisible();
      expect(await overflow(page)).toBe(false);
      expect(await overflow(page)).toBe(false);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`every state has no detectable accessibility problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const check = async (label: string) => {
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${label}: ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      };
      await seed(page, [FLAGGED, APFEL]);
      await expect(page.getByTestId('practice-flagged')).toBeVisible();
      await check('warnings');
      await page.getByRole('button', { name: t.practice.start }).click();
      await expect(prompt(page)).toBeVisible();
      await check('question');
      await type(page, 'elma');
      await check('feedback');
      await next(page);
      await expect(waiting(page)).toBeVisible();
      await check('waiting');
      await check('summary');
    });
  }

  test('screen readers hear each question and each result', async ({ page }) => {
    await seed(page, [APFEL]);
    const live = page.getByTestId('practice-announcement');
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toContainText('der Apfel');
    await type(page, 'elma');
    await expect(live).toContainText(t.practice.correct);
    await next(page);
    await expect(waiting(page)).toBeVisible();
  });

  test('Escape ends the session, keeping what was answered', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Uses a keyboard');
    await seed(page, [APFEL, TUER]);
    await type(page, 'bilmem');
    await next(page).catch(() => undefined);
    await page.keyboard.press('Escape');
    await expect(heading(page)).toHaveText(t.review.summaryWaitingTitle);
    expect(await logs(page)).toHaveLength(1);
  });
});

test.describe('autocorrect is really off', () => {
  // The text "off" written as a property is truthy, so a browser with this property would read it as on.
  const isOff = (page: Page, selector: string) =>
    page.locator(selector).first().evaluate((el) => {
      const input = el as HTMLInputElement & { autocorrect?: boolean };
      return !('autocorrect' in input) || input.autocorrect === false;
    });

  test('in the dictionary, the word form and import', async ({ page }) => {
    await seed(page, [APFEL], [], '#/dictionary');
    await expect(page.locator('input[type="search"], input[type="text"]').first()).toBeVisible();
    expect(await isOff(page, 'input[type="search"], input[type="text"]')).toBe(true);
    await page.goto('./#/dictionary/new');
    await expect(page.locator('#word-german')).toBeVisible();
    expect(await isOff(page, '#word-german')).toBe(true);
    await page.goto('./#/import');
    await expect(page.locator('#import-text')).toBeVisible();
    expect(await isOff(page, '#import-text')).toBe(true);
  });

  test('when picking words for a collection', async ({ page }) => {
    await seed(page, [APFEL], [], '#/');
    await write(page, { groups: [{ id: 'g2', kind: 'custom', name: 'Listem', order: 1, sourceId: null, createdAt: 1 }] });
    await page.goto('./#/collections/g2');
    await page.reload();
    await page.getByRole('main').getByRole('button', { name: new RegExp(t.collections.addWords) }).first().click();
    const search = page.getByRole('dialog').locator('input[type="search"], input[type="text"]').first();
    await expect(search).toBeVisible();
    expect(await isOff(page, 'dialog input[type="search"], dialog input[type="text"]')).toBe(true);
  });
});

test('a session passes over words deleted with their collection', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await seed(page, [APFEL, TUER], [reviewCard('apfel', 'tr_de', OVERDUE()), reviewCard('tuer', 'tr_de', OVERDUE())], '#/');
  await write(page, {
    groups: [{ id: 'g1', kind: 'custom', name: 'Silinecek', order: 0, sourceId: null, createdAt: 1 }],
    groupMembers: [{ groupId: 'g1', wordId: 'apfel', addedAt: 1, importRowId: null }, { groupId: 'g1', wordId: 'tuer', addedAt: 1, importRowId: null }],
  });
  await page.goto('./#/review');
  await page.reload();
  await expect(prompt(page)).toBeVisible();
  await page.goto('./#/collections/g1');
  await page.getByRole('button', { name: t.collections.deleteList }).click();
  await page.getByRole('dialog').getByRole('radio', { name: new RegExp(t.collections.deleteWithWords) }).check();
  await page.getByRole('dialog').getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
  await expect(heading(page)).toHaveText(t.collections.title);
  await page.goto('./#/review');
  await expect(page.getByText(t.practice.emptyTitle)).toBeVisible();
  expect(await cards(page)).toEqual([]);
  expect(problems).toEqual([]);
});
