import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

interface Seed {
  id: string;
  lemma: string;
  article: 'der' | 'die' | 'das' | null;
  meanings: string[];
  favorite?: boolean;
  deleted?: boolean;
}

const WORDS: readonly Seed[] = [
  { id: 'apfel', lemma: 'Apfel', article: 'der', meanings: ['elma'], favorite: true },
  { id: 'tuer', lemma: 'Tür', article: 'die', meanings: ['kapı'] },
  { id: 'haus', lemma: 'Haus', article: 'das', meanings: ['ev'] },
  { id: 'danke', lemma: 'danke', article: null, meanings: ['teşekkürler'] },
  { id: 'was', lemma: 'Was?', article: null, meanings: ['ne?'] },
  { id: 'urlaub', lemma: 'Urlaub', article: 'der', meanings: ['tatil (tatile çıkmak vb.)'] },
];

const toRecord = (word: Seed) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: word.meanings.map((text) => ({ text, note: null })), senseTag: null, searchTokens: [], favoritedAt: word.favorite ? 1 : null, createdAt: 1, updatedAt: 1, deletedAt: word.deleted ? 1 : null });

const CARD = { wordId: 'apfel', track: 'tr_de', due: 9_999_999_999_999, fsrs: { stability: 3, difficulty: 5, dueAt: 9_999_999_999_999, lastReviewAt: 1000, state: 2, scheduleStatus: 'review', reps: 4, lapses: 1, scheduledDays: 9, learningStep: 0 }, schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1' };

/** Stores data the way the app does, then opens practice fresh. */
async function seed(page: Page, words: readonly Seed[] = WORDS, extra: Record<string, unknown[]> = {}) {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(
    ([records, others]) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const names = ['words', ...Object.keys(others as object)];
          const tx = db.transaction(names, 'readwrite');
          for (const record of records as unknown[]) tx.objectStore('words').put(record);
          for (const [name, rows] of Object.entries(others as Record<string, unknown[]>)) for (const row of rows) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [words.map(toRecord), extra] as const,
  );
  await page.goto('./#/practice');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.practice.title);
}

const readTable = (page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction(name).objectStore(name).getAll();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result as Record<string, unknown>[]);
          };
        };
      }),
    table,
  );

const logs = async (page: Page) => (await readTable(page, 'reviewLogs')) as { wordId: string; track: string; typed: string; result: string; hintsUsed: number; retry?: boolean; mode: string; sessionId?: string }[];

const pick = (page: Page, name: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${name}$`) }).click();
const startButton = (page: Page) => page.getByRole('button', { name: t.practice.start });
const start = async (page: Page, mode?: string, count?: string) => {
  if (mode) await pick(page, mode);
  if (count) await pick(page, count);
  await startButton(page).click();
  await expect(page.getByTestId('practice-question')).toBeVisible();
};
const question = (page: Page) => page.getByTestId('practice-question').innerText();
const field = (page: Page) => page.getByLabel(t.practice.answerLabel);
const action = (page: Page) => page.getByTestId('practice-action');
const feedback = (page: Page) => page.getByTestId('practice-feedback');

/** Answers from the seed, whichever word came up. */
function rightAnswer(prompt: string, cue: string, words: readonly Seed[] = WORDS): string {
  const hit = words.find((word) => word.meanings.join(', ') === prompt || word.lemma === prompt || `${word.article} ${word.lemma}` === prompt);
  if (!hit) throw new Error(`No seed word for ${prompt}`);
  if (cue.includes(t.practice.cue.article)) return hit.article!;
  if (cue.includes(t.practice.cue.de_tr)) return hit.meanings[0]!;
  return hit.article ? `${hit.article} ${hit.lemma}` : hit.lemma;
}
const answerRight = async (page: Page, words: readonly Seed[] = WORDS) => {
  await field(page).fill(rightAnswer(await question(page), await page.getByTestId('practice-cue').innerText(), words));
  await page.keyboard.press('Enter');
  await expect(feedback(page)).toBeVisible();
};
/** Moves on, and waits until the feedback has really gone. */
const nextByButton = async (page: Page) => {
  await action(page).click();
  await expect(feedback(page)).toHaveCount(0);
};

test.describe('setup', () => {
  test('nothing to practice leads to adding words', async ({ page }) => {
    await page.goto('./#/practice');
    await page.reload();
    await expect(page.getByText(t.practice.emptyTitle)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: t.nav.import })).toBeVisible();
    await expect(startButton(page)).toHaveCount(0);
  });

  test('offers four modes, counts what would be asked, and adds no info area', async ({ page }) => {
    await seed(page);
    await expect(page.getByTestId('practice-blocked')).toHaveCount(0);
    await expect(page.locator('.practice-start')).toHaveText(t.practice.start);
    for (const mode of Object.values(t.practice.modes)) await expect(page.getByRole('radio', { name: mode })).toBeVisible();
    await expect(startButton(page)).toHaveAttribute('data-questions', '6');
    await pick(page, t.practice.modes.article);
    await expect(startButton(page)).toHaveAttribute('data-questions', '4');
  });

  test('scope joins what is chosen, counts a shared word once, and never includes a deleted one', async ({ page }) => {
    await seed(page, [...WORDS, { id: 'gone', lemma: 'Weg', article: 'der', meanings: ['yol'], deleted: true }], {
      groups: [{ id: 'g1', kind: 'pdf', name: 'bolum-1.pdf', order: 0, sourceId: null, createdAt: 1 }, { id: 'g2', kind: 'custom', name: 'Listem', order: 1, sourceId: null, createdAt: 1 }],
      groupMembers: [{ groupId: 'g1', wordId: 'apfel', addedAt: 1, importRowId: null }, { groupId: 'g1', wordId: 'gone', addedAt: 1, importRowId: null }, { groupId: 'g2', wordId: 'apfel', addedAt: 1, importRowId: null }, { groupId: 'g2', wordId: 'haus', addedAt: 1, importRowId: null }],
    });
    await expect(page.getByRole('checkbox', { name: new RegExp(t.practice.allWords) })).toBeChecked();
    await page.getByRole('checkbox', { name: /bolum-1/ }).check();
    await expect(page.getByRole('checkbox', { name: new RegExp(t.practice.allWords) })).not.toBeChecked();
    await expect(startButton(page)).toHaveAttribute('data-questions', '1');
    await page.getByRole('checkbox', { name: /Listem/ }).check();
    await expect(startButton(page)).toHaveAttribute('data-questions', '2');
    await page.getByRole('checkbox', { name: new RegExp(t.practice.favorites) }).check();
    await expect(startButton(page)).toHaveAttribute('data-questions', '2');

    await startButton(page).click();
    const seen = new Set<string>();
    for (let i = 0; i < 2; i++) {
      seen.add(await question(page));
      await answerRight(page);
      await nextByButton(page);
    }
    expect([...seen].sort()).toEqual(['elma', 'ev']);
    await expect(page.getByTestId('practice-summary')).toBeVisible();
  });

  test('spacing matches Settings: 8 under a label, 24 between sections', async ({ page }) => {
    await seed(page);
    const gaps = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.setup-group')].slice(0, 2).map((group) => ({ group: group.getBoundingClientRect(), label: group.querySelector('legend')!.getBoundingClientRect(), body: group.querySelector('.segmented, .list')!.getBoundingClientRect() }));
      return { under: boxes[0]!.body.top - boxes[0]!.label.bottom, between: boxes[1]!.group.top - boxes[0]!.group.bottom };
    });
    expect(gaps.under).toBeCloseTo(8, 0);
    expect(gaps.between).toBeCloseTo(24, 0);
  });

  test('turning everything off returns to all words', async ({ page }) => {
    await seed(page);
    const favorites = page.getByRole('checkbox', { name: new RegExp(t.practice.favorites) });
    await favorites.check();
    await expect(startButton(page)).toHaveAttribute('data-questions', '1');
    await favorites.uncheck();
    await expect(page.getByRole('checkbox', { name: new RegExp(t.practice.allWords) })).toBeChecked();
    await page.getByRole('checkbox', { name: new RegExp(t.practice.allWords) }).click();
    await expect(page.getByRole('checkbox', { name: new RegExp(t.practice.allWords) })).toBeChecked();
  });

  test('difficult words become available once history shows some', async ({ page }) => {
    await seed(page);
    await expect(page.getByRole('checkbox', { name: new RegExp(t.practice.difficult) })).toBeDisabled();
    await seed(page, WORDS, { reviewLogs: [{ seq: 1, mode: 'practice', wordId: 'tuer', track: 'tr_de', at: 5, typed: 'x', result: 'wrong', hintsUsed: 0 }] });
    const difficult = page.getByRole('checkbox', { name: new RegExp(t.practice.difficult) });
    await expect(difficult).toBeEnabled();
    await difficult.check();
    await expect(startButton(page)).toHaveAttribute('data-questions', '1');
  });

  test('a selection with nothing to ask explains itself and cannot start', async ({ page }) => {
    await seed(page, WORDS.filter((word) => word.article === null));
    await pick(page, t.practice.modes.article);
    await expect(page.getByTestId('practice-blocked')).toHaveText(t.practice.noArticles);
    await expect(startButton(page)).toBeDisabled();
  });

  test('remembers the last choices', async ({ page }) => {
    await seed(page);
    await pick(page, t.practice.modes.de_tr);
    await pick(page, '50');
    await page.reload();
    await expect(page.getByRole('radio', { name: t.practice.modes.de_tr })).toBeChecked();
    await expect(page.getByRole('radio', { name: '50' })).toBeChecked();
  });
});

test.describe('questions and answers', () => {
  test('Turkish to German: requires the article, and Enter moves everything along', { tag: '@smoke' }, async ({ page }) => {
    await seed(page, [WORDS[0]!, WORDS[1]!]);
    await start(page, t.practice.modes.tr_de);
    await expect(field(page)).toBeFocused();
    // A phone must not rewrite or capitalize German.
    await expect(field(page)).toHaveAttribute('autocapitalize', 'off');
    expect(await field(page).evaluate((el: HTMLInputElement) => (el as unknown as { autocorrect?: boolean }).autocorrect === true || el.getAttribute('autocorrect') === 'on')).toBe(false);
    await expect(page.getByTestId('practice-cue')).toHaveText(t.practice.cue.tr_de_noun);
    const target = (await question(page)) === 'elma' ? WORDS[0]! : WORDS[1]!;

    await field(page).fill(target.lemma);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.reasons.article_missing);
    await expect(page.getByTestId('practice-answer-shown')).toContainText(`${target.article} ${target.lemma}`);
    await expect(page.getByTestId('practice-announcement')).toContainText(t.practice.reasons.article_missing);
    await expect(field(page)).toBeFocused();

    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveCount(0);
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
  });

  test('German to Turkish: an alternative meaning and an explanation both work', async ({ page }) => {
    const words: Seed[] = [{ id: 'reis', lemma: 'Reis', article: 'der', meanings: ['pirinç', 'pilav'] }, WORDS[5]!];
    await seed(page, words);
    await start(page, t.practice.modes.de_tr);
    await expect(page.getByTestId('practice-cue')).toHaveText(t.practice.cue.de_tr);
    for (let i = 0; i < 2; i++) {
      const prompt = await question(page);
      await field(page).fill(prompt.includes('Reis') ? 'pilav' : 'tatil');
      await page.keyboard.press('Enter');
      await expect(feedback(page)).toContainText(t.practice.correct);
      if (prompt.includes('Reis')) await expect(feedback(page)).toContainText('pirinç');
      await nextByButton(page);
    }
    await expect(page.getByTestId('practice-score')).toHaveText('2 / 2');
  });

  test('article mode leaves out words with no article, shows the meaning, and answers by button or by typing', async ({ page }) => {
    await seed(page);
    await start(page, t.practice.modes.article);
    const asked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const prompt = await question(page);
      asked.push(prompt);
      await expect(page.getByTestId('practice-detail')).toBeVisible();
      await expect(page.getByRole('button', { name: t.practice.hint })).toHaveCount(0);
      await expect(page.getByRole('button', { name: t.practice.insert('ä') })).toHaveCount(0);
      const article = WORDS.find((word) => word.lemma === prompt)!.article!;
      if (i % 2) {
        await field(page).fill(article);
        await page.keyboard.press('Enter');
      } else {
        await page.getByRole('group', { name: t.practice.articles }).getByRole('button', { name: article, exact: true }).click();
      }
      await expect(feedback(page)).toContainText(t.practice.correct);
      await nextByButton(page);
    }
    expect(asked.sort()).toEqual(['Apfel', 'Haus', 'Tür', 'Urlaub']);
    const history = await logs(page);
    expect(new Set(history.map((log) => log.track))).toEqual(new Set(['article']));
  });

  test('mixed mode asks each word once, with more than one kind of question', async ({ page }) => {
    await seed(page);
    await start(page, t.practice.modes.mixed);
    for (let i = 0; i < WORDS.length; i++) {
      await answerRight(page);
      await nextByButton(page);
    }
    await expect(page.getByTestId('practice-score')).toHaveText('6 / 6');
    const history = await logs(page);
    expect(new Set(history.map((log) => log.wordId)).size).toBe(6);
    expect(new Set(history.map((log) => log.track)).size).toBeGreaterThan(1);
  });

  test('Was? is answered without the question mark', async ({ page }) => {
    await seed(page, [WORDS[4]!]);
    await start(page, t.practice.modes.tr_de);
    await field(page).fill('was');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.correct);
  });

  test('a wrong noun article is not accepted, and a close spelling is called close', async ({ page }) => {
    await seed(page, [WORDS[0]!, WORDS[2]!]);
    await start(page, t.practice.modes.tr_de);
    const first = (await question(page)) === 'elma';
    await field(page).fill(first ? 'die Apfel' : 'die Haus');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.reasons.article_wrong);
    await nextByButton(page);
    await field(page).fill(first ? 'das Hauss' : 'der Apfell');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.reasons.typo);
  });

  test('showing the answer is one press and counts as missed, and an empty Enter does nothing', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await start(page);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveCount(0);
    await expect(action(page)).toHaveText(t.practice.check);
    await expect(action(page)).toBeDisabled();
    await field(page).fill('x');
    await expect(action(page)).toBeEnabled();
    await field(page).fill('');
    await page.getByTestId('practice-reveal').click();
    await expect(feedback(page)).toContainText(t.practice.revealed);
    await expect(page.getByTestId('practice-answer-shown')).toBeVisible();
    await expect(page.getByTestId('practice-reveal')).toHaveCount(0);
    expect(await logs(page)).toHaveLength(1);
    expect((await logs(page))[0]).toMatchObject({ typed: '', result: 'wrong', hintsUsed: 0 });
    await expect(page.getByTestId('practice-count')).toContainText('+1');
  });

  test('a held or doubled Enter cannot skip the feedback', async ({ page }) => {
    await seed(page, WORDS.slice(0, 3));
    await start(page);
    await field(page).fill('x');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toBeVisible();
    await expect(page.getByTestId('practice-count')).toContainText('1 / 3');
    expect(await logs(page)).toHaveLength(1);
  });
});

test.describe('German letters', () => {
  const start2 = async (page: Page) => {
    await seed(page, [WORDS[1]!]);
    await start(page, t.practice.modes.tr_de);
  };

  test('insert at the cursor, replace a selection, and keep the focus', async ({ page }) => {
    await start2(page);
    await field(page).fill('die Tr');
    await field(page).evaluate((el: HTMLInputElement) => el.setSelectionRange(5, 5));
    await page.getByRole('button', { name: t.practice.insert('ü') }).click();
    await expect(field(page)).toHaveValue('die Tür');
    await expect(field(page)).toBeFocused();
    expect(await field(page).evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(6);

    await field(page).evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 6));
    await page.getByRole('button', { name: t.practice.insert('ß') }).click();
    await expect(field(page)).toHaveValue('die ßr');
    expect(await field(page).evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(5);
  });

  test('a noun starts with a capital, even after the article, and typing carries on from there', async ({ page }) => {
    await start2(page);
    await field(page).fill('die ');
    await page.getByRole('button', { name: t.practice.insert('ü') }).click();
    await expect(field(page)).toHaveValue('die Ü');
    await page.keyboard.type('r');
    await expect(field(page)).toHaveValue('die Ür');
  });

  test('are not offered when the answer is Turkish', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await start(page, t.practice.modes.de_tr);
    await expect(page.getByRole('button', { name: t.practice.insert('ä') })).toHaveCount(0);
  });
});

test.describe('hints', () => {
  test('show a first letter once, stay with that attempt, and are saved with it', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await start(page, t.practice.modes.tr_de);
    const apfelFirst = (await question(page)) === 'elma';
    await page.getByRole('button', { name: t.practice.hint }).click();
    await expect(page.getByTestId('practice-hint')).toHaveText(t.practice.hintShown(apfelFirst ? 'A…' : 'T…'));
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
    await expect(page.getByTestId('practice-announcement')).toContainText(t.practice.hintShown(apfelFirst ? 'A…' : 'T…'));

    await field(page).fill(apfelFirst ? 'der Apfel' : 'die Tür');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.correctHinted);
    expect((await logs(page))[0]).toMatchObject({ hintsUsed: 1, result: 'correct' });

    await nextByButton(page);
    await expect(page.getByRole('button', { name: t.practice.hint })).toBeVisible();
  });

  test('a correct answer after a hint is asked again and is not counted as a clean first try', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await start(page, t.practice.modes.tr_de);
    await page.getByRole('button', { name: t.practice.hint }).click();
    await answerRight(page);
    await nextByButton(page);
    await answerRight(page);
    await nextByButton(page);
    await expect(page.getByTestId('practice-cue')).toContainText(t.practice.retry);
    await answerRight(page);
    await nextByButton(page);
    await expect(page.getByTestId('practice-score')).toHaveText('1 / 2');
    await expect(page.getByTestId('practice-summary')).toContainText(t.practice.firstHinted);
  });
});

test.describe('retries and progress', () => {
  test('a wrong answer returns after other questions, is marked, and does not move the progress', async ({ page }) => {
    await seed(page, WORDS.slice(0, 3));
    await start(page, t.practice.modes.tr_de);
    const missed = await question(page);
    await field(page).fill('yanlış');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('practice-count')).toContainText('1 / 3');
    await expect(page.getByTestId('practice-count')).toContainText('+1');
    await nextByButton(page);
    expect(await question(page)).not.toBe(missed);

    await answerRight(page);
    await nextByButton(page);
    await answerRight(page);
    await expect(page.getByTestId('practice-count')).toContainText('3 / 3');
    await nextByButton(page);

    expect(await question(page)).toBe(missed);
    await expect(page.getByTestId('practice-cue')).toContainText(t.practice.retry);
    await answerRight(page);
    await expect(page.getByTestId('practice-count')).toContainText('3 / 3');
    await expect(action(page)).toHaveText(t.practice.seeSummary);
    await nextByButton(page);

    await expect(page.getByTestId('practice-score')).toHaveText('2 / 3');
    await expect(page.getByTestId('practice-summary')).toContainText(t.practice.firstWrong);
    await expect(page.getByTestId('practice-summary')).toContainText(t.practice.recovered);

    const history = await logs(page);
    expect(history).toHaveLength(4);
    expect(history.filter((log) => log.retry === true)).toHaveLength(1);
    expect(history.every((log) => log.mode === 'practice' && typeof log.sessionId === 'string')).toBe(true);
    expect(new Set(history.map((log) => log.sessionId)).size).toBe(1);
  });

  test('one word alone still works, wrong or right, and is never repeated straight away', async ({ page }) => {
    await seed(page, [WORDS[0]!]);
    await start(page, t.practice.modes.tr_de);
    await field(page).fill('yanlış');
    await page.keyboard.press('Enter');
    await expect(action(page)).toHaveText(t.practice.seeSummary);
    await nextByButton(page);
    await expect(page.getByTestId('practice-score')).toHaveText('0 / 1');
    await page.getByRole('button', { name: t.practice.anotherRound }).click();
    await answerRight(page);
    await nextByButton(page);
    await expect(page.getByTestId('practice-score')).toHaveText('1 / 1');
  });

  test('answering wrong every time still ends the round', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await start(page, t.practice.modes.tr_de);
    for (let i = 0; i < 6; i++) {
      await field(page).fill('yanlış');
      await page.keyboard.press('Enter');
      await nextByButton(page);
    }
    await expect(page.getByTestId('practice-summary')).toContainText(t.practice.unresolved);
    expect(await logs(page)).toHaveLength(6);
  });

  test('practice has no limit: round after round is open, and rounds move through different words', async ({ page }) => {
    await seed(page);
    await pick(page, t.practice.modes.tr_de);
    await startButton(page).click();
    const asked: string[] = [];
    for (let round = 0; round < 6; round++) {
      await expect(page.getByTestId('practice-question')).toBeVisible();
      for (let i = 0; i < 6; i++) {
        if (round === 0) asked.push(await question(page));
        await answerRight(page);
        await nextByButton(page);
      }
      await expect(page.getByTestId('practice-summary')).toBeVisible();
      await page.getByRole('button', { name: t.practice.anotherRound }).click();
    }
    expect(new Set(asked).size).toBe(6);
    expect(await logs(page)).toHaveLength(36);
  });

  test('a chosen count sets the round, with no percentage shown', async ({ page }) => {
    const many: Seed[] = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, lemma: `Wort${i}`, article: null, meanings: [`anlam${i}`] }));
    await seed(page, many);
    await start(page, t.practice.modes.tr_de, '10');
    await expect(page.getByTestId('practice-count')).toContainText('0 / 10');
    for (let i = 0; i < 10; i++) {
      await answerRight(page, many);
      await nextByButton(page);
    }
    await expect(page.getByTestId('practice-summary')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('%');
  });
});

test.describe('closing and coming back', () => {
  test('closing before any answer asks nothing', async ({ page }) => {
    await seed(page);
    await start(page);
    await page.getByRole('button', { name: t.common.close }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/$/);
  });

  test('closing after answers asks first, and Keep going really keeps going', async ({ page }) => {
    await seed(page);
    await start(page);
    await field(page).fill('yanlış');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: t.common.close }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(t.practice.closeBody);
    await dialog.getByRole('button', { name: t.practice.keepGoing }).click();
    await expect(dialog).toHaveCount(0);
    await expect(feedback(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(feedback(page)).toBeVisible();

    await page.getByRole('button', { name: t.common.close }).click();
    await dialog.getByRole('button', { name: t.practice.closeConfirm }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect(await logs(page)).toHaveLength(1);

    await page.goto('./#/practice');
    await expect(startButton(page)).toBeVisible();
  });

  test('a reload continues from the same place and logs nothing twice', async ({ page }) => {
    await seed(page, WORDS.slice(0, 3));
    await start(page, t.practice.modes.tr_de);
    await field(page).fill('yanlış');
    await page.keyboard.press('Enter');
    const prompt = await question(page);
    await expect.poll(async () => (await logs(page)).length).toBe(1);
    await page.reload();
    await expect(feedback(page)).toBeVisible();
    expect(await question(page)).toBe(prompt);
    await expect(field(page)).toHaveValue('yanlış');
    await nextByButton(page);
    await page.reload();
    await expect(page.getByTestId('practice-question')).toBeVisible();
    await expect(page.getByTestId('practice-count')).toContainText('1 / 3');
    expect(await logs(page)).toHaveLength(1);
  });

  test('a word deleted during a round is never asked', async ({ page }) => {
    await seed(page, WORDS.slice(0, 3));
    await start(page, t.practice.modes.tr_de);
    await answerRight(page);
    const asked = await question(page);
    const others = WORDS.slice(0, 3).filter((word) => word.meanings[0] !== asked).map((word) => word.id);
    await page.evaluate(
      (ids) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.open('vosli');
          request.onsuccess = () => {
            const tx = request.result.transaction('words', 'readwrite');
            for (const id of ids) {
              const read = tx.objectStore('words').get(id);
              read.onsuccess = () => tx.objectStore('words').put({ ...read.result, deletedAt: 5 });
            }
            tx.oncomplete = () => {
              request.result.close();
              resolve();
            };
          };
        }),
      others,
    );
    await nextByButton(page);
    await expect(page.getByTestId('practice-summary')).toBeVisible();
    expect(await logs(page)).toHaveLength(1);
  });

  test('from the summary: another round, only the missed words, or back to the choices', async ({ page }) => {
    await seed(page, WORDS.slice(0, 3));
    await start(page, t.practice.modes.tr_de);
    const missed = await question(page);
    await field(page).fill('yanlış');
    await page.keyboard.press('Enter');
    await nextByButton(page);
    for (let i = 0; i < 3; i++) {
      await answerRight(page);
      await nextByButton(page);
    }
    await page.getByRole('button', { name: t.practice.missedRound }).click();
    await expect(page.getByTestId('practice-count')).toContainText('0 / 1');
    expect(await question(page)).toBe(missed);
    await answerRight(page);
    await nextByButton(page);
    await expect(page.getByTestId('practice-score')).toHaveText('1 / 1');
    await expect(page.getByRole('button', { name: t.practice.missedRound })).toHaveCount(0);
    await page.getByRole('button', { name: t.practice.changeSettings }).click();
    await expect(startButton(page)).toBeVisible();
    await expect(page.getByRole('radio', { name: t.practice.modes.tr_de })).toBeChecked();
  });
});

test.describe('history and safety', () => {
  test('practice records history and changes no card, word or due date', { tag: '@smoke' }, async ({ page }) => {
    await seed(page, WORDS.slice(0, 2), { cards: [CARD] });
    const [cardsBefore, wordsBefore] = [await readTable(page, 'cards'), await readTable(page, 'words')];
    await start(page, t.practice.modes.tr_de);
    await field(page).fill('yanlış');
    await page.keyboard.press('Enter');
    await nextByButton(page);
    await answerRight(page);
    await nextByButton(page);
    await answerRight(page);
    await nextByButton(page);
    await expect(page.getByTestId('practice-summary')).toBeVisible();
    expect(await readTable(page, 'cards')).toEqual(cardsBefore);
    expect(await readTable(page, 'words')).toEqual(wordsBefore);
    const history = await logs(page);
    expect(history).toHaveLength(3);
    for (const log of history) {
      expect(log).not.toHaveProperty('grade');
      expect(log).not.toHaveProperty('prevFsrs');
    }
  });

  test('a backup made after practice restores, with the history in it', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await start(page, t.practice.modes.tr_de);
    await field(page).fill('yanlış');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await logs(page)).length).toBe(1);
    await page.getByRole('button', { name: t.common.close }).click();
    await page.getByRole('dialog').getByRole('button', { name: t.practice.closeConfirm }).click();

    await page.goto('./#/settings');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: t.settings.download }).click();
    const download = await downloading;
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    expect((JSON.parse(text) as { tables: { reviewLogs: { retry?: boolean; sessionId?: string }[] } }).tables.reviewLogs[0]!.sessionId).toBeTruthy();

    await page.locator('input[type=file]').setInputFiles({ name: 'yedek.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.getByRole('dialog').getByRole('button', { name: t.restore.confirm }).click();
    await expect(page.getByText(t.restore.done)).toBeVisible();
    expect(await logs(page)).toHaveLength(1);
  });
});

test.describe('dictionary warnings', () => {
  const AUTOMAT: Seed = { id: 'automat', lemma: 'Geldautomat', article: 'das', meanings: ['bankamatik'] };
  const HUND: Seed = { id: 'hund', lemma: 'Hund', article: 'der', meanings: ['köpek'] };
  const UNKNOWN: Seed = { id: 'unknown', lemma: 'Xyzzyquark', article: 'der', meanings: ['bilinmeyen'] };
  const DISMISSED = [{ key: 'dictionaryDismissals', value: ['dict:article_wrong|das|Geldautomat'] }];

  test('a flagged word waits, and a word the dictionary does not know is still asked', async ({ page }) => {
    await seed(page, [AUTOMAT, HUND, UNKNOWN]);
    await expect(page.getByTestId('practice-flagged')).toContainText(t.practice.flaggedCount('1'));
    await expect(startButton(page)).toHaveAttribute('data-questions', '2');
    await page.getByRole('checkbox', { name: t.practice.includeFlagged }).check();
    await expect(startButton(page)).toHaveAttribute('data-questions', '3');
  });

  test('the warning can be reviewed, and leads to the word', async ({ page }) => {
    await seed(page, [AUTOMAT, HUND]);
    await page.getByRole('button', { name: t.practice.reviewFlagged }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('das Geldautomat');
    await expect(dialog).toContainText(t.validation.issues.article_wrong);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(startButton(page)).toBeVisible();
    await page.getByRole('button', { name: t.practice.reviewFlagged }).click();
    await dialog.getByRole('link', { name: /Geldautomat/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.wordForm.editTitle);
  });

  test('when included, it is not taught as certain, and its article is not tested', async ({ page }) => {
    await seed(page, [AUTOMAT]);
    await page.getByRole('checkbox', { name: t.practice.includeFlagged }).check();
    await pick(page, t.practice.modes.article);
    await expect(startButton(page)).toBeDisabled();
    await pick(page, t.practice.modes.de_tr);
    await start(page);
    expect(await question(page)).toBe('Geldautomat');
    await field(page).fill('bankamatik');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.correct);
    // Waits in the corner of the card, takes no room in the feedback, and leaves the session open on Escape.
    await expect(feedback(page).getByTestId('practice-caution')).toHaveCount(0);
    await expect(page.getByTestId('practice-announcement')).toContainText(t.practice.dictionaryCaution('der Geldautomat'));
    await page.getByRole('button', { name: t.practice.cautionLabel }).click();
    await expect(page.getByTestId('practice-caution')).toHaveText(t.practice.dictionaryCaution('der Geldautomat'));
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('practice-caution')).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readTable(page, 'words')).toMatchObject([{ lemma: 'Geldautomat', article: 'das' }]);
  });

  test('a Turkish to German question accepts either form and says which is saved', async ({ page }) => {
    await seed(page, [AUTOMAT]);
    await page.getByRole('checkbox', { name: t.practice.includeFlagged }).check();
    await pick(page, t.practice.modes.tr_de);
    await start(page);
    await expect(page.getByTestId('practice-cue')).toHaveText(t.practice.cue.tr_de);
    await field(page).fill('der Geldautomat');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(t.practice.correct);
    await expect(feedback(page)).toContainText(t.practice.dictionaryNote('das Geldautomat'));
  });

  test('an accepted warning is simply gone', async ({ page }) => {
    await seed(page, [AUTOMAT], { meta: DISMISSED });
    await expect(page.getByTestId('practice-flagged')).toHaveCount(0);
    await pick(page, t.practice.modes.article);
    await start(page);
    await page.getByRole('group', { name: t.practice.articles }).getByRole('button', { name: 'das', exact: true }).click();
    await expect(feedback(page)).toContainText(t.practice.correct);
    await expect(page.getByTestId('practice-caution')).toHaveCount(0);
  });
});

test.describe('keyboard and accessibility', () => {
  test('a whole question can be done from the keyboard, with focus going where it should', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile, 'Desktop keyboard flow');
    await seed(page, [WORDS[1]!, WORDS[2]!]);
    await pick(page, t.practice.modes.tr_de);
    await startButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeFocused();
    // The order is the field, the letters, the hint, then the action.
    await page.keyboard.type('die T');
    // Safari skips buttons on Tab by default, so there the button is focused directly.
    if (browserName === 'webkit') await page.getByRole('button', { name: t.practice.insert('ü') }).focus();
    else for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: t.practice.insert('ü') })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue(/ü|Ü/);
    await field(page).fill('');
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveCount(0);
    await expect(field(page)).toBeFocused();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`setup, question, feedback, dialog and summary have no detectable problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((value) => localStorage.setItem('vosli.theme', value), scheme);
      const scan = async (where: string) => {
        // A screen fading in has no final colors to measure yet.
        await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${where} ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      };
      await seed(page, [...WORDS.slice(0, 2), { id: 'automat', lemma: 'Geldautomat', article: 'das', meanings: ['bankamatik'] }], {
        groups: [{ id: 'g1', kind: 'pdf', name: 'bolum-1.pdf', order: 0, sourceId: null, createdAt: 1 }],
        groupMembers: [{ groupId: 'g1', wordId: 'apfel', addedAt: 1, importRowId: null }],
      });
      await expect(page.getByTestId('practice-flagged')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // The Start bar is sticky, so a row can rest partly beneath it until scrolled. Measure the row in the open.
      await page.getByRole('checkbox', { name: t.practice.includeFlagged }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await scan('setup');
      await page.getByRole('checkbox', { name: t.practice.includeFlagged }).check();
      await pick(page, t.practice.modes.tr_de);
      await start(page);
      await scan('question');
      await page.getByRole('button', { name: t.practice.hint }).click();
      await scan('hint');
      await field(page).fill('yanlış');
      await page.keyboard.press('Enter');
      await scan('wrong');
      await page.getByRole('button', { name: t.common.close }).click();
      await page.waitForTimeout(250);
      await scan('dialog');
      await page.getByRole('button', { name: t.practice.keepGoing }).click();
      await nextByButton(page);
      for (let i = 0; i < 3; i++) {
        const prompt = await question(page);
        const seed2 = [...WORDS.slice(0, 2), { id: 'automat', lemma: 'Geldautomat', article: 'das' as const, meanings: ['bankamatik'] }];
        await field(page).fill(rightAnswer(prompt, await page.getByTestId('practice-cue').innerText(), seed2));
        await page.keyboard.press('Enter');
        if (i === 0) await scan('correct');
        await nextByButton(page);
      }
      await expect(page.getByTestId('practice-summary')).toBeVisible();
      await scan('summary');
    });
  }
});

test.describe('layouts', () => {
  const LONG: Seed[] = [
    { id: 'long', lemma: 'Donaudampfschifffahrtsgesellschaft', article: 'die', meanings: ['Tuna buharlı gemi işletmeciliği şirketi (uzun bir açıklama burada duruyor)'] },
    { id: 'long2', lemma: 'Rindfleischetikettierungsüberwachungsaufgabe', article: 'die', meanings: ['sığır eti etiketleme denetimi görevi'] },
  ];
  const noOverflow = (page: Page) =>
    page.evaluate(() => {
      const main = document.querySelector('main')!;
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
    });

  for (const [width, height, rootPx] of [[320, 568, 16], [390, 780, 16], [667, 375, 16], [320, 568, 24], [390, 780, 32]] as const) {
    test(`setup, session and summary hold at ${width}x${height} with ${rootPx}px text`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'Sizes are set by hand here');
      await page.setViewportSize({ width, height });
      if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
      await seed(page, LONG, {
        groups: [{ id: 'g1', kind: 'pdf', name: 'Achtung Deutsch Bölüm 1 konu sonu kelime listesi ve alıştırmalar.pdf', order: 0, sourceId: null, createdAt: 1 }],
        groupMembers: [{ groupId: 'g1', wordId: 'long', addedAt: 1, importRowId: null }],
      });
      expect(await noOverflow(page)).toEqual({ page: 0, main: 0 });
      await expect(startButton(page)).toBeInViewport();
      await pick(page, t.practice.modes.tr_de);
      await start(page);
      expect(await noOverflow(page)).toEqual({ page: 0, main: 0 });
      await expect(action(page)).toBeInViewport();
      await field(page).fill('yanlış');
      await page.keyboard.press('Enter');
      await expect(feedback(page)).toBeVisible();
      expect(await noOverflow(page)).toEqual({ page: 0, main: 0 });
      await expect(action(page)).toBeInViewport();
    });
  }

  test('with the visible height cut to what a phone keyboard leaves, the next step stays on screen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Sizes are set by hand here');
    await page.setViewportSize({ width: 390, height: 780 });
    await seed(page, WORDS.slice(0, 2));
    await start(page, t.practice.modes.tr_de);
    await page.evaluate(() => document.documentElement.style.setProperty('--session-height', '380px'));
    const box = await page.locator('main').boundingBox();
    expect(box!.height).toBeLessThanOrEqual(380);
    const [fieldBox, actionBox] = [await field(page).boundingBox(), await action(page).boundingBox()];
    expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(380);
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(380);
  });

  test('the action keeps its distance from the answer card, on every kind of question', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await pick(page, t.practice.modes.article);
    await start(page);
    const gap = async () => {
      const [card, button] = [await page.locator('.practice-answer').boundingBox(), await action(page).boundingBox()];
      return button!.y - (card!.y + card!.height);
    };
    expect(await gap()).toBeGreaterThanOrEqual(12);
    await field(page).fill('x');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toBeVisible();
    expect(await gap()).toBeGreaterThanOrEqual(12);
  });

  test('the answer area does not move between question and feedback', async ({ page }) => {
    await seed(page, WORDS.slice(0, 2));
    await start(page, t.practice.modes.tr_de);
    const before = await action(page).boundingBox();
    await field(page).fill('der Apfel');
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toBeVisible();
    const after = await action(page).boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  });
});

test.describe('a collection deleted around a round', () => {
  const TWO = WORDS.slice(0, 2);
  const GROUPS = {
    groups: [{ id: 'g1', kind: 'pdf', name: 'Silinecek', order: 0, sourceId: null, createdAt: 1 }],
    groupMembers: TWO.map((word) => ({ groupId: 'g1', wordId: word.id, addedAt: 1, importRowId: null })),
  };

  const begin = async (page: Page, problems: string[]) => {
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
    await seed(page, WORDS, GROUPS);
    await page.evaluate(() => localStorage.setItem('vosli.practice-settings', JSON.stringify({ mode: 'tr_de', count: 10, scope: { all: false, favorites: false, difficult: false, groupIds: ['g1'] }, includeFlagged: true })));
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.practice.title);
    await start(page);
  };

  const deleteIt = async (page: Page) => {
    await page.goto('./#/collections/g1');
    await page.getByRole('button', { name: t.collections.deleteCollection }).click();
    await page.getByRole('dialog').getByRole('button', { name: t.common.delete }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.collections.title);
    await page.goto('./#/practice');
  };

  const allWordsChosen = async (page: Page) => {
    await expect(page.getByRole('checkbox', { name: new RegExp(t.practice.allWords) })).toBeChecked();
    await expect(startButton(page)).toBeEnabled();
    // Still so after a reload, when the choice comes from what was saved.
    await page.reload();
    await expect(page.getByRole('checkbox', { name: new RegExp(t.practice.allWords) })).toBeChecked();
    await expect(startButton(page)).toBeEnabled();
  };

  test('during a round: the round goes on, then the choice returns to the learner', async ({ page }) => {
    const problems: string[] = [];
    await begin(page, problems);
    await answerRight(page, TWO);
    await deleteIt(page);
    await expect(feedback(page)).toBeVisible();
    await nextByButton(page);
    await answerRight(page, TWO);
    await action(page).click();
    await page.getByRole('button', { name: t.practice.anotherRound }).click();
    await allWordsChosen(page);
    await startButton(page).click();
    await expect(page.getByTestId('practice-question')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('deleting the words too: the round drops them and the app carries on', async ({ page }) => {
    const problems: string[] = [];
    await begin(page, problems);
    await answerRight(page, TWO);
    await page.goto('./#/collections/g1');
    await page.getByRole('button', { name: t.collections.deleteCollection }).click();
    await page.getByRole('dialog').getByRole('radio', { name: new RegExp(t.collections.deleteWithWords) }).check();
    await page.getByRole('dialog').getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.collections.title);
    await page.goto('./#/practice');
    await allWordsChosen(page);
    expect((await readTable(page, 'words')).map((word) => word.id)).not.toContain(TWO[0]!.id);
    expect(problems).toEqual([]);
  });

  test('after a round: changing the settings is not stuck on the deleted collection', async ({ page }) => {
    const problems: string[] = [];
    await begin(page, problems);
    await answerRight(page, TWO);
    await nextByButton(page);
    await answerRight(page, TWO);
    await action(page).click();
    await expect(page.getByRole('button', { name: t.practice.changeSettings })).toBeVisible();
    await deleteIt(page);
    await page.getByRole('button', { name: t.practice.changeSettings }).click();
    await allWordsChosen(page);
    expect(problems).toEqual([]);
  });
});

test('words deleted from the dictionary leave the open round, and the rest goes on', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  await seed(page);
  await start(page, undefined, undefined);
  await page.goto('./#/dictionary');
  await page.getByRole('main').getByRole('button', { name: t.common.select, exact: true }).click();
  await page.getByRole('button', { name: t.common.selectAll }).click();
  await page.getByRole('checkbox', { name: /danke/ }).uncheck();
  await page.getByRole('main').getByRole('button', { name: t.common.delete, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.goto('./#/practice');
  const only = WORDS.filter((word) => word.id === 'danke');
  // Only the kept word is left to ask, and the round ends after it.
  await expect(page.getByTestId('practice-question')).toHaveText(/teşekkürler|danke/);
  await answerRight(page, only);
  await action(page).click();
  await expect(page.getByRole('button', { name: t.practice.anotherRound })).toBeVisible();
  expect(problems).toEqual([]);
  expect((await readTable(page, 'words')).map((word) => word.id)).toEqual(['danke']);
});
