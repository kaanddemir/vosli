import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

interface Seed {
  id: string;
  lemma: string;
  article: 'der' | 'die' | 'das' | null;
  meaning: string;
}

const WORDS: readonly Seed[] = [
  { id: 'apfel', lemma: 'Apfel', article: 'der', meaning: 'elma' },
  { id: 'birne', lemma: 'Birne', article: 'die', meaning: 'armut' },
  { id: 'haus', lemma: 'Haus', article: 'das', meaning: 'ev' },
  { id: 'tisch', lemma: 'Tisch', article: 'der', meaning: 'masa' },
  { id: 'tuer', lemma: 'Tür', article: 'die', meaning: 'kapı' },
  { id: 'buch', lemma: 'Buch', article: 'das', meaning: 'kitap' },
  { id: 'danke', lemma: 'danke', article: null, meaning: 'teşekkürler' },
  { id: 'lesen', lemma: 'lesen', article: null, meaning: 'okumak' },
  { id: 'schreiben', lemma: 'schreiben', article: null, meaning: 'yazmak' },
  { id: 'klein', lemma: 'klein', article: null, meaning: 'küçük' },
];

const LONG: Seed = { id: 'lang', lemma: 'Donaudampfschifffahrtsgesellschaftskapitän', article: 'der', meaning: 'Tuna buharlı gemi işletmesinin kaptanı (uzun bir açıklama)' };
const EXTRA: readonly Seed[] = Array.from({ length: 14 }, (_, index): Seed => ({ id: `n${index}`, lemma: `Nomen${index}`, article: 'das', meaning: `isim${index}` }));
/** Every word any test here saves, so an answer can always be worked out. */
const KNOWN: readonly Seed[] = [...WORDS, LONG, ...EXTRA];

const record = (word: Seed) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: [{ text: word.meaning, note: null }], senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null });

const GROUPS = {
  groups: [{ id: 'g1', kind: 'custom', name: 'Meyveler', order: 0, sourceId: null, createdAt: 1 }],
  groupMembers: [
    { groupId: 'g1', wordId: 'apfel', addedAt: 1, importRowId: null },
    { groupId: 'g1', wordId: 'birne', addedAt: 1, importRowId: null },
  ],
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

/** Every table the app keeps, as it stands. A test must leave all of it exactly as it found it. */
const snapshot = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const request = indexedDB.open('vosli');
        request.onsuccess = () => {
          const db = request.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names);
          const out: Record<string, unknown[]> = {};
          for (const name of names) {
            const read = tx.objectStore(name).getAll();
            read.onsuccess = () => (out[name] = read.result as unknown[]);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(JSON.stringify(out, Object.keys(out).sort()));
          };
        };
      }),
  );

const tableSize = (page: Page, name: string) =>
  page.evaluate(
    (store) =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open('vosli');
        request.onsuccess = () => {
          const read = request.result.transaction(store).objectStore(store).count();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result);
          };
        };
      }),
    name,
  );

/** Leaves only these words in the library: the others are deleted the way the app deletes them. */
async function keepOnly(page: Page, keep: readonly Seed[]) {
  const ids = new Set(keep.map((word) => word.id));
  await write(page, { words: WORDS.filter((word) => !ids.has(word.id)).map((word) => ({ ...record(word), deletedAt: 1 })) });
  await openSetup(page);
}

const pick = (page: Page, name: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${name}$`) }).click();
const startTest = (page: Page) => page.getByRole('button', { name: t.practice.test.start });
const options = (page: Page) => page.getByTestId('test-option');
const radios = (page: Page) => page.locator('input[name="test-choice"]');
const submit = (page: Page) => page.getByTestId('practice-action');
const count = (page: Page) => page.getByTestId('practice-count');

async function openSetup(page: Page) {
  await page.goto('./#/practice');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.practice.title);
}

async function begin(page: Page, mode: string, howMany: string = t.practice.countAll) {
  await pick(page, t.practice.studies.test);
  await pick(page, mode);
  await pick(page, howMany);
  await startTest(page).click();
  await expect(radios(page).first()).toBeVisible();
}

/** The right option for the question on screen, worked out from the seed alone. */
async function rightAnswer(page: Page): Promise<string> {
  const prompt = await page.getByTestId('practice-question').innerText();
  const cue = await page.getByTestId('practice-cue').innerText();
  const label = (word: Seed) => (word.article ? `${word.article} ${word.lemma}` : word.lemma);
  if (cue === t.practice.cue.article) return KNOWN.find((word) => word.lemma === prompt)!.article!;
  if (cue === t.practice.cue.tr_de) return label(KNOWN.find((word) => word.meaning === prompt)!);
  return KNOWN.find((word) => label(word) === prompt)!.meaning;
}

const optionTexts = (page: Page) => page.locator('.choice-text').allInnerTexts();

/** Gives an answer to the question on screen, and waits for its verdict. Returns the right option's text and the option chosen. */
async function give(page: Page, how: 'right' | 'wrong' | 'blank') {
  const right = await rightAnswer(page);
  const texts = await optionTexts(page);
  const index = how === 'blank' ? -1 : how === 'right' ? texts.indexOf(right) : texts.findIndex((text) => text !== right);
  if (how === 'blank') await page.getByTestId('test-blank').click();
  else {
    expect(index, `${right} in ${texts.join(' | ')}`).toBeGreaterThanOrEqual(0);
    await options(page).nth(index).click();
    await submit(page).click();
  }
  await expect(page.getByTestId('practice-feedback')).toBeVisible();
  return { right, rightIndex: texts.indexOf(right), chosen: index };
}

/** Answers the question on screen, then moves on and waits until the next one, or the results, are there. */
async function answer(page: Page, how: 'right' | 'wrong' | 'blank') {
  await give(page, how);
  await submit(page).click();
  // Cevapla comes back only on the next question.
  await expect(page.getByTestId('test-summary').or(submit(page).filter({ hasText: t.practice.test.submit }))).toBeVisible();
}

/** Nothing in the session judges an answer before it is given. */
async function expectNoVerdict(page: Page) {
  await expect(page.locator('.feedback, [data-testid="practice-feedback"], [data-testid="practice-answer-shown"], .field-correct, .field-wrong')).toHaveCount(0);
  const text = await page.locator('.practice-session').evaluate((root) => {
    const parts = [root.textContent ?? ''];
    for (const element of root.querySelectorAll('*')) for (const attribute of element.attributes) if (!['class', 'style', 'd', 'viewBox'].includes(attribute.name)) parts.push(attribute.value);
    return parts.join(' ');
  });
  for (const word of [t.practice.correct, t.practice.wrong, t.practice.answerWas, t.practice.test.rightAnswer]) expect(text).not.toContain(word);
}

test.beforeEach(async ({ page }) => {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await write(page, { words: WORDS.map(record), ...GROUPS });
  await openSetup(page);
});

test.describe('setup', () => {
  test('four ways to study in a two-by-two grid, with Test last and the choice remembered', async ({ page }) => {
    const study = page.getByRole('group', { name: t.practice.studyLabel });
    const names = [t.practice.studies.typed, t.practice.studies.listen, t.practice.studies.cards, t.practice.studies.test];
    await expect(study.getByRole('radio')).toHaveCount(4);
    for (const [index, name] of names.entries()) await expect(study.getByRole('radio').nth(index)).toHaveAccessibleName(name);
    const boxes = await page.locator('input[name="practice-study"] + span').evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect()).map(({ x, y, width }) => ({ x, y, width })));
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
    expect(Math.abs(boxes[2]!.y - boxes[3]!.y)).toBeLessThan(2);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(Math.abs(boxes[0]!.x - boxes[2]!.x)).toBeLessThan(2);

    await pick(page, t.practice.studies.test);
    await expect(page.getByRole('group', { name: t.practice.modeLabel })).toBeVisible();
    for (const mode of Object.values(t.practice.modes)) await expect(page.getByRole('radio', { name: mode })).toBeVisible();
    await expect(page.getByRole('group', { name: t.practice.countLabel })).toBeVisible();
    await expect(page.getByRole('group', { name: t.practice.scopeLabel })).toBeVisible();
    await expect(startTest(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: t.practice.start, exact: true })).toHaveCount(0);

    await page.reload();
    await expect(study.getByRole('radio', { name: t.practice.studies.test })).toBeChecked();
    // The card mode keeps its stored value under its new name.
    await pick(page, t.practice.studies.cards);
    await page.reload();
    await expect(study.getByRole('radio', { name: t.practice.studies.cards })).toBeChecked();
    await expect(page.getByRole('button', { name: t.practice.startCards })).toBeVisible();
  });

  test('counts only what can be asked with safe options, and says why when nothing can', async ({ page }) => {
    await pick(page, t.practice.studies.test);
    await pick(page, t.practice.countAll);
    await pick(page, t.practice.modes.tr_de);
    await expect(startTest(page)).toHaveAttribute('data-questions', '10');
    await pick(page, t.practice.modes.article);
    await expect(startTest(page)).toHaveAttribute('data-questions', '6');
    // A two-word collection still works: the other options come from the rest of the library.
    await pick(page, t.practice.modes.de_tr);
    await page.getByRole('checkbox', { name: /Meyveler/ }).check();
    await expect(startTest(page)).toHaveAttribute('data-questions', '2');
    await startTest(page).click();
    await expect(radios(page)).toHaveCount(4);
    await expect(count(page)).toHaveText('0 / 2');
  });

  test('a library too small for four different options cannot start a translation test', async ({ page }) => {
    await keepOnly(page, WORDS.slice(0, 3));
    await pick(page, t.practice.studies.test);
    await pick(page, t.practice.modes.tr_de);
    await expect(page.getByTestId('practice-blocked')).toHaveText(t.practice.test.notEnough);
    await expect(startTest(page)).toBeDisabled();
    // Articles need no other words.
    await pick(page, t.practice.modes.article);
    await expect(startTest(page)).toBeEnabled();
    await pick(page, t.practice.modes.mixed);
    await expect(startTest(page)).toHaveAttribute('data-questions', '3');
  });

  test('a short test says how many questions it really has', async ({ page }) => {
    // Four nouns can each be asked in German; the lone verb has no other verbs to stand beside.
    await keepOnly(page, [...WORDS.slice(0, 4), WORDS[7]!]);
    await pick(page, t.practice.studies.test);
    await pick(page, t.practice.modes.tr_de);
    await pick(page, t.practice.countAll);
    await expect(page.getByTestId('practice-coverage')).toHaveText(t.practice.test.available('4'));
    await expect(startTest(page)).toHaveAttribute('data-questions', '4');
  });
});

test.describe('taking a test', () => {
  test('chooses, changes its mind, answers, and is judged only after answering; nothing is written', async ({ page }) => {
    const before = await snapshot(page);
    await begin(page, t.practice.modes.tr_de);
    await expect(count(page)).toHaveText('0 / 10');
    await expect(radios(page)).toHaveCount(4);
    await expect(page.locator('.choice-key')).toHaveText(['A', 'B', 'C', 'D']);
    await expect(submit(page)).toHaveText(t.practice.test.submit);
    await expect(submit(page)).toBeDisabled();
    await expect(page.locator('#practice-answer')).toHaveCount(0);

    // A tap only selects, and the choice can change before answering.
    await options(page).nth(0).click();
    await expect(radios(page).nth(0)).toBeChecked();
    await expect(page.getByTestId('practice-count')).toHaveText('0 / 10');
    await options(page).nth(2).click();
    await expect(radios(page).nth(0)).not.toBeChecked();
    await expect(radios(page).nth(2)).toBeChecked();
    await expect(submit(page)).toBeEnabled();
    await expectNoVerdict(page);

    // Ten questions: three right, then a wrong one, a blank, and the rest right. Each is judged only once answered.
    const plan = ['right', 'right', 'right', 'wrong', 'blank', 'right', 'right', 'right', 'right', 'right'] as const;
    for (const how of plan) {
      await expectNoVerdict(page);
      await answer(page, how);
    }

    const summary = page.getByTestId('test-summary');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.practice.test.summaryTitle);
    await expect(summary.getByTestId('test-accuracy')).toHaveText('%80');
    await expect(summary.getByTestId('test-score')).toHaveText(t.practice.test.score('8', '10'));
    await expect(summary.getByTestId('test-correct')).toHaveText('8');
    await expect(summary.getByTestId('test-wrong')).toHaveText('1');
    await expect(summary.getByTestId('test-blank-count')).toHaveText('1');
    const missed = summary.getByTestId('test-missed');
    await expect(missed).toHaveCount(2);
    await expect(missed.nth(0)).toContainText(t.practice.test.yourAnswer);
    await expect(missed.nth(0)).toContainText(t.practice.test.rightAnswer);
    await expect(missed.nth(1)).toContainText(`${t.practice.test.yourAnswer}: ${t.practice.test.blankAnswer}`);
    expect(await snapshot(page)).toBe(before);
  });

  test('three article options in their usual order', async ({ page }) => {
    await begin(page, t.practice.modes.article);
    await expect(radios(page)).toHaveCount(3);
    await expect(page.locator('.choice-text')).toHaveText(['der', 'die', 'das']);
    await expect(page.getByTestId('practice-detail')).toBeVisible();
    await expect(page.getByTestId('practice-cue')).toHaveText(t.practice.cue.article);
  });

  test('works by keyboard alone: arrows choose, Enter answers, Enter again moves on', async ({ page }) => {
    await begin(page, t.practice.modes.de_tr);
    await expect(radios(page).first()).toBeFocused();
    await expect(page.getByTestId('practice-announcement')).toContainText(t.practice.test.questionSpoken('1', '10'));
    // Enter with nothing chosen does nothing.
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('0 / 10');
    await expect(page.getByTestId('practice-feedback')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(radios(page).nth(1)).toBeChecked();
    await page.keyboard.press('Enter');
    // Answered: judged at once, options closed, focus on the way on.
    await expect(page.getByTestId('practice-feedback')).toBeVisible();
    await expect(count(page)).toHaveText('1 / 10');
    await expect(submit(page)).toBeFocused();
    await expect(submit(page)).toHaveText(t.practice.test.next);
    for (const radio of await radios(page).all()) await expect(radio).toBeDisabled();
    await expect(page.getByTestId('practice-announcement')).toContainText(/Doğru|Yanlış/u);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('practice-feedback')).toHaveCount(0);
    await expect(radios(page).first()).toBeFocused();
    await expect(radios(page).nth(1)).not.toBeChecked();
    await expect(page.getByTestId('practice-announcement')).toContainText(t.practice.test.questionSpoken('2', '10'));
  });

  test('a reload brings back the same question, options and progress', async ({ page }) => {
    await begin(page, t.practice.modes.mixed);
    await answer(page, 'right');
    await answer(page, 'blank');
    const prompt = await page.getByTestId('practice-question').innerText();
    const texts = await optionTexts(page);
    await page.reload();
    await expect(count(page)).toHaveText('2 / 10');
    await expect(page.getByTestId('practice-question')).toHaveText(prompt);
    expect(await optionTexts(page)).toEqual(texts);
    // Finished results survive a reload too.
    for (let left = 0; left < 8; left++) await answer(page, 'right');
    await page.reload();
    await expect(page.getByTestId('test-score')).toHaveText(t.practice.test.score('9', '10'));
  });
});

test.describe('feedback after each answer', () => {
  const marked = (page: Page, result: 'right' | 'wrong') => page.locator(`[data-testid="test-option"][data-result="${result}"]`);

  test('a right answer turns its option green with a check, and says so', async ({ page }) => {
    await begin(page, t.practice.modes.tr_de);
    await expect(marked(page, 'right')).toHaveCount(0);
    const { right, rightIndex } = await give(page, 'right');
    await expect(page.getByTestId('practice-feedback')).toHaveText(t.practice.correct);
    await expect(page.getByTestId('practice-feedback')).toHaveClass(/feedback-correct/u);
    await expect(marked(page, 'right')).toHaveCount(1);
    await expect(marked(page, 'wrong')).toHaveCount(0);
    await expect(options(page).nth(rightIndex)).toHaveAttribute('data-result', 'right');
    await expect(marked(page, 'right').locator('.choice-text')).toHaveText(right);
    await expect(marked(page, 'right').locator('.choice-key svg')).toHaveCount(1);
    await expect(page.getByTestId('test-blank')).toHaveCount(0);
    await expect(submit(page)).toHaveText(t.practice.test.next);
    await expect(submit(page)).toBeEnabled();
  });

  test('a wrong answer turns the choice red with a cross and the right option green', async ({ page }) => {
    await begin(page, t.practice.modes.de_tr);
    const { right, rightIndex, chosen } = await give(page, 'wrong');
    await expect(page.getByTestId('practice-feedback')).toHaveText(t.practice.wrong);
    await expect(page.getByTestId('practice-feedback')).toHaveClass(/feedback-wrong/u);
    await expect(options(page).nth(chosen)).toHaveAttribute('data-result', 'wrong');
    await expect(options(page).nth(rightIndex)).toHaveAttribute('data-result', 'right');
    await expect(marked(page, 'wrong').locator('.choice-key svg')).toHaveCount(1);
    // The colors are said too, for a screen reader.
    await expect(marked(page, 'right')).toContainText(t.practice.answerWas);
    await expect(marked(page, 'wrong')).toContainText(t.practice.test.chosen);
    await expect(page.getByTestId('practice-announcement')).toContainText(`${t.practice.answerWas}: ${right}`);
    // Closed: a tap on another option changes nothing.
    await options(page).nth(rightIndex).click({ force: true });
    await expect(options(page).nth(chosen)).toHaveAttribute('data-result', 'wrong');
    await expect(radios(page).nth(chosen)).toBeChecked();
  });

  test('a blank shows the right option, and moves on from there', async ({ page }) => {
    await begin(page, t.practice.modes.tr_de);
    const { rightIndex } = await give(page, 'blank');
    await expect(page.getByTestId('practice-feedback')).toHaveText(t.practice.test.blanked);
    await expect(page.getByTestId('practice-feedback')).toHaveClass(/feedback-revealed/u);
    await expect(options(page).nth(rightIndex)).toHaveAttribute('data-result', 'right');
    await expect(marked(page, 'wrong')).toHaveCount(0);
    for (const radio of await radios(page).all()) await expect(radio).not.toBeChecked();
    await submit(page).click();
    await expect(count(page)).toHaveText('1 / 10');
    await expect(submit(page)).toHaveText(t.practice.test.submit);
    await expect(page.getByTestId('practice-feedback')).toHaveCount(0);
  });

  test('the last question says Sonuçları gör, and the results follow only after it', async ({ page }) => {
    await begin(page, t.practice.modes.article);
    for (let index = 0; index < 5; index++) await answer(page, 'right');
    await give(page, 'wrong');
    await expect(submit(page)).toHaveText(t.practice.test.results);
    await expect(page.getByTestId('test-summary')).toHaveCount(0);
    await submit(page).click();
    await expect(page.getByTestId('test-score')).toHaveText(t.practice.test.score('5', '6'));
  });

  test('a reload keeps an answer on screen as it was shown, and it cannot be answered again', async ({ page }) => {
    await begin(page, t.practice.modes.de_tr);
    await answer(page, 'right');
    const { rightIndex, chosen } = await give(page, 'wrong');
    await page.reload();
    await expect(page.getByTestId('practice-feedback')).toHaveText(t.practice.wrong);
    await expect(options(page).nth(chosen)).toHaveAttribute('data-result', 'wrong');
    await expect(options(page).nth(rightIndex)).toHaveAttribute('data-result', 'right');
    await expect(count(page)).toHaveText('2 / 10');
    await expect(submit(page)).toHaveText(t.practice.test.next);
    await expect(page.getByTestId('test-blank')).toHaveCount(0);
    for (const radio of await radios(page).all()) await expect(radio).toBeDisabled();
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('vosli.test-session')!) as { picks: unknown[]; at: number });
    expect(saved.picks).toHaveLength(2);
    expect(saved.at).toBe(1);
    await submit(page).click();
    await expect(count(page)).toHaveText('2 / 10');
    await expect(submit(page)).toHaveText(t.practice.test.submit);
    expect((await page.evaluate(() => JSON.parse(sessionStorage.getItem('vosli.test-session')!) as { picks: unknown[] })).picks).toHaveLength(2);
  });
});

test.describe('leaving', () => {
  test('closing before any answer asks nothing', async ({ page }) => {
    await begin(page, t.practice.modes.de_tr);
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/$/);
  });

  test('after an answer it asks the way practice does, Escape too, and leaving discards the test', async ({ page }) => {
    await begin(page, t.practice.modes.de_tr);
    await answer(page, 'wrong');
    await page.getByRole('button', { name: t.common.close }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText(t.practice.test.closeTitle);
    await expect(dialog).toContainText(t.practice.test.closeBody);
    await expect(dialog.getByRole('button')).toHaveText([t.practice.keepGoing, t.practice.closeConfirm]);
    await dialog.getByRole('button', { name: t.practice.keepGoing }).click();
    await expect(dialog).toHaveCount(0);
    await expect(count(page)).toHaveText('1 / 10');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: t.common.close }).click();
    await dialog.getByRole('button', { name: t.practice.closeConfirm }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect(await page.evaluate(() => sessionStorage.getItem('vosli.test-session'))).toBeNull();
    // No partial results: practice opens on its setup.
    await page.goto('./#/practice');
    await expect(startTest(page)).toBeVisible();
    await expect(page.getByTestId('test-summary')).toHaveCount(0);
  });

  test('a listening round says truthfully that its answers are not saved', async ({ page }) => {
    // Set up a listening round as saved state, without needing any sound.
    await page.evaluate(() =>
      sessionStorage.setItem(
        'vosli.practice-session',
        JSON.stringify({ id: 'l1', settings: { mode: 'tr_de', scope: { all: true, favorites: false, difficult: false, groupIds: [] }, count: 20, includeFlagged: false }, items: [{ wordId: 'apfel', track: 'listen', attempts: 1, first: 'wrong', last: 'wrong' }, { wordId: 'haus', track: 'listen', attempts: 0, first: null, last: null }], queue: [1], hinted: false, hints: 0, answered: null }),
      ),
    );
    await page.reload();
    await expect(page.getByTestId('listen-play')).toBeVisible();
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page.getByRole('dialog')).toContainText(t.practice.closeBodyListen);
    await expect(page.getByRole('dialog')).not.toContainText(t.practice.closeBody);
  });
});

test.describe('after the test', () => {
  test('practising the missed questions is an ordinary typed round, and its next round is typed too', async ({ page }) => {
    await begin(page, t.practice.modes.tr_de, '10');
    for (let index = 0; index < 10; index++) await answer(page, index < 2 ? 'wrong' : 'right');
    const logsBefore = await tableSize(page, 'reviewLogs');
    await page.getByRole('button', { name: t.practice.test.missedRound }).click();
    await expect(page.locator('#practice-answer')).toBeVisible();
    await expect(page.getByTestId('practice-count')).toHaveText('0 / 2');
    await expect(page.getByTestId('practice-cue')).toContainText(t.practice.cue.tr_de);
    expect(await page.evaluate(() => sessionStorage.getItem('vosli.test-session'))).toBeNull();
    expect(await tableSize(page, 'groups')).toBe(1);

    // Revealing every answer runs the round the usual way, repeats included, with normal practice history.
    let attempts = 0;
    for (;;) {
      await expect(page.getByTestId('practice-summary').or(page.getByTestId('practice-reveal'))).toBeVisible();
      if (await page.getByTestId('practice-summary').isVisible()) break;
      await page.getByTestId('practice-reveal').click();
      await expect(page.getByTestId('practice-feedback')).toBeVisible();
      await page.getByTestId('practice-action').click();
      attempts++;
      expect(attempts).toBeLessThanOrEqual(6);
    }
    expect(attempts).toBeGreaterThanOrEqual(2);
    await expect.poll(() => tableSize(page, 'reviewLogs')).toBe(logsBefore + attempts);
    await page.getByRole('button', { name: t.practice.anotherRound }).click();
    await expect(page.locator('#practice-answer')).toBeVisible();
    await expect(radios(page)).toHaveCount(0);
  });

  test('a new test draws again, and changing settings returns to the Test setup', async ({ page }) => {
    await begin(page, t.practice.modes.de_tr);
    const draws: string[] = [];
    for (let round = 0; round < 3; round++) {
      const seen: string[] = [];
      for (let index = 0; index < 10; index++) {
        seen.push(`${await page.getByTestId('practice-question').innerText()}:${(await optionTexts(page)).join(',')}`);
        await answer(page, 'right');
      }
      draws.push(seen.join('|'));
      await expect(page.getByTestId('test-accuracy')).toHaveText('%100');
      await expect(page.getByRole('button', { name: t.practice.test.missedRound })).toHaveCount(0);
      if (round < 2) {
        await page.getByRole('button', { name: t.practice.test.again }).click();
        await expect(count(page)).toHaveText('0 / 10');
      }
    }
    expect(new Set(draws).size).toBeGreaterThan(1);
    await page.getByRole('button', { name: t.practice.changeSettings }).click();
    await expect(page.getByRole('radio', { name: t.practice.studies.test })).toBeChecked();
    await expect(page.getByRole('radio', { name: t.practice.modes.de_tr })).toBeChecked();
    // Setup closes as it always has.
    await page.getByRole('link', { name: t.common.close }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('the results close without asking', async ({ page }) => {
    await begin(page, t.practice.modes.article);
    for (let index = 0; index < 6; index++) await answer(page, 'blank');
    await expect(page.getByTestId('test-accuracy')).toHaveText('%0');
    await expect(page.getByTestId('test-missed')).toHaveCount(6);
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/$/);
  });
});

test.describe('layout and accessibility', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`setup, a question and the results fit 320px and 200% text with no detectable problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((value) => localStorage.setItem('vosli.theme', value), scheme);
      const scan = async (label: string) => {
        await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label).toBeLessThanOrEqual(0);
      };
      // A long compound and a long meaning, to see that rows wrap rather than widen the page.
      await write(page, { words: [record(LONG)] });
      for (const [width, size] of [[390, '16px'], [320, '16px'], [320, '32px']] as const) {
        await page.setViewportSize({ width, height: 700 });
        await openSetup(page);
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), size);
        await pick(page, t.practice.studies.test);
        const boxes = await page.locator('input[name="practice-study"] + span').evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().width));
        expect(Math.max(...boxes) - Math.min(...boxes), `${width} ${size}`).toBeLessThan(2);
        // Rows pass under the sticky start bar by design. At the end of the page nothing is under it, so the scan sees the layout itself.
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await scan(`${width} ${size} setup`);
        await pick(page, t.practice.modes.tr_de);
        await pick(page, t.practice.countAll);
        await startTest(page).click();
        await expect(radios(page)).toHaveCount(4);
        for (const option of await options(page).all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await options(page).first().click();
        await scan(`${width} ${size} question`);
        await give(page, 'wrong');
        await scan(`${width} ${size} feedback`);
        await submit(page).click();
        for (let index = 0; index < 10; index++) await answer(page, index % 3 === 0 ? 'blank' : 'right');
        await expect(page.getByTestId('test-summary')).toBeVisible();
        await scan(`${width} ${size} results`);
        await page.evaluate(() => sessionStorage.clear());
      }
    });
  }

  test('many misses are shown a few at a time', async ({ page }) => {
    await write(page, { words: EXTRA.map(record) });
    await openSetup(page);
    await begin(page, t.practice.modes.article);
    for (let index = 0; index < 20; index++) await answer(page, 'blank');
    await expect(page.getByTestId('test-missed')).toHaveCount(10);
    await page.getByRole('button', { name: t.practice.test.showAll('20') }).click();
    await expect(page.getByTestId('test-missed')).toHaveCount(20);
  });
});
