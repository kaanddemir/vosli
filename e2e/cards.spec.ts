import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

interface Seed {
  id: string;
  lemma: string;
  article: 'der' | 'die' | 'das' | null;
  meaning: string;
  favorite?: boolean;
}

const WORDS: readonly Seed[] = [
  { id: 'apfel', lemma: 'Apfel', article: 'der', meaning: 'elma', favorite: true },
  { id: 'tuer', lemma: 'Tür', article: 'die', meaning: 'kapı' },
  { id: 'haus', lemma: 'Haus', article: 'das', meaning: 'ev' },
  { id: 'danke', lemma: 'danke', article: null, meaning: 'teşekkürler' },
];
const BY_FRONT = new Map(WORDS.flatMap((word) => [[word.article ? `${word.article} ${word.lemma}` : word.lemma, word], [word.meaning, word]] as const));

const record = (word: Seed) => ({ id: word.id, identityKey: `${word.lemma}|${word.article ?? ''}`, lemma: word.lemma, article: word.article, pos: word.article ? 'noun' : 'other', plural: null, meanings: [{ text: word.meaning, note: null }], senseTag: null, searchTokens: [], favoritedAt: word.favorite ? 1 : null, createdAt: 1, updatedAt: 1, deletedAt: null });

const GROUPS = {
  groups: [{ id: 'g1', kind: 'custom', name: 'Listem', order: 0, sourceId: null, createdAt: 1 }],
  groupMembers: [{ groupId: 'g1', wordId: 'haus', addedAt: 1, importRowId: null }],
};

/** Writes the way the app does, so a test can also change words while a session is open. */
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

const count = (page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open('vosli');
        request.onsuccess = () => {
          const read = request.result.transaction(name).objectStore(name).count();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result);
          };
        };
      }),
    table,
  );

const pick = (page: Page, name: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${name}$`) }).click();
const startCards = (page: Page) => page.getByRole('button', { name: t.practice.startCards });
const front = (page: Page) => page.getByTestId('card-front');
const back = (page: Page) => page.getByTestId('card-back');
const next = (page: Page) => page.getByTestId('card-next');
const previous = (page: Page) => page.getByTestId('card-previous');
const position = (page: Page) => page.getByTestId('card-position');

test.beforeEach(async ({ page }) => {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await write(page, { words: WORDS.map(record), ...GROUPS });
  await page.goto('./#/practice');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.practice.title);
});

test('Yazarak stays the default, and Kartlarla swaps only what differs', async ({ page }) => {
  const study = page.getByRole('group', { name: t.practice.studyLabel });
  await expect(study.getByRole('radio', { name: t.practice.studies.typed })).toBeChecked();
  await expect(page.getByRole('group', { name: t.practice.modeLabel })).toBeVisible();
  await expect(page.getByRole('button', { name: t.practice.start, exact: true })).toBeVisible();

  await pick(page, t.practice.studies.cards);
  await expect(page.getByRole('group', { name: t.practice.modeLabel })).toHaveCount(0);
  await expect(page.getByRole('group', { name: t.practice.directionLabel }).getByRole('radio', { name: t.practice.directions.de_tr })).toBeChecked();
  await expect(page.getByRole('group', { name: t.practice.cardCountLabel })).toBeVisible();
  await expect(page.getByRole('group', { name: t.practice.scopeLabel })).toBeVisible();
  await expect(startCards(page)).toHaveAttribute('data-questions', '4');

  // The choice is remembered, and switching back restores typed practice exactly.
  await page.reload();
  await expect(startCards(page)).toBeVisible();
  await pick(page, t.practice.studies.typed);
  await expect(page.getByRole('group', { name: t.practice.modeLabel })).toBeVisible();
  await page.getByRole('button', { name: t.practice.start, exact: true }).click();
  await expect(page.locator('#practice-answer')).toBeVisible();
  await expect(page.getByTestId('card-study')).toHaveCount(0);
});

test('cards show both sides, move freely, switch direction, and end without a score', async ({ page }) => {
  await pick(page, t.practice.studies.cards);
  await startCards(page).click();
  await expect(position(page)).toHaveText('1 / 4');
  await expect(previous(page)).toBeDisabled();
  const first = await front(page).innerText();
  const word = BY_FRONT.get(first)!;
  await expect(front(page)).toHaveAttribute('lang', 'de');
  await expect(back(page)).toHaveText(word.meaning);
  await expect(back(page)).toHaveAttribute('lang', 'tr');
  // Nothing to answer here.
  await expect(page.locator('input[type="text"], .feedback, .article-choice')).toHaveCount(0);

  await page.getByTestId('card-direction').click();
  await expect(page.getByTestId('card-direction')).toHaveAttribute('aria-pressed', 'true');
  await expect(front(page)).toHaveText(word.meaning);
  await expect(back(page)).toHaveText(first);

  await next(page).click();
  await expect(position(page)).toHaveText('2 / 4');
  await previous(page).click();
  await expect(position(page)).toHaveText('1 / 4');
  await expect(front(page)).toHaveText(word.meaning);

  // Arrow keys move too.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(position(page)).toHaveText('4 / 4');
  await expect(next(page)).toHaveText(t.practice.cards.finish);
  await page.keyboard.press('ArrowLeft');
  await expect(position(page)).toHaveText('3 / 4');
  await next(page).click();
  await next(page).click();

  await expect(page.getByRole('heading', { name: t.practice.cards.doneTitle })).toBeFocused();
  await expect(page.getByTestId('card-study')).not.toContainText('%');
  await page.getByRole('button', { name: t.practice.cards.restart }).click();
  await expect(position(page)).toHaveText('1 / 4');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: t.practice.changeSettings }).click();
  await expect(startCards(page)).toBeVisible();

  expect(await count(page, 'reviewLogs')).toBe(0);
  expect(await count(page, 'cards')).toBe(0);
});

test('a covered side is out of the page until revealed, and covers again on every move', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('vosli.article-colors', 'on'));
  await page.reload();
  await pick(page, t.practice.studies.cards);
  await pick(page, t.practice.directions.tr_de);
  await startCards(page).click();
  await page.getByTestId('card-hide').click();
  await expect(page.getByTestId('card-hide')).toHaveAttribute('aria-pressed', 'true');

  const shown = await front(page).innerText();
  const word = BY_FRONT.get(shown)!;
  const german = word.article ? `${word.article} ${word.lemma}` : word.lemma;
  const card = page.getByTestId('card-study');
  await expect(back(page)).toHaveCount(0);
  await expect(card).not.toContainText(word.lemma);
  await expect(card.locator('.article-der, .article-die, .article-das')).toHaveCount(0);
  await expect(page.getByTestId('card-announcement')).not.toContainText(word.lemma);
  const reveal = page.getByRole('button', { name: t.practice.cards.revealGerman });
  await expect(reveal).not.toHaveAttribute('aria-label', new RegExp(word.lemma));
  const slot = await page.locator('.study-back-slot').boundingBox();

  await reveal.click();
  await expect(back(page)).toHaveText(german);
  await expect(back(page)).toBeFocused();
  expect(Math.abs((await page.locator('.study-back-slot').boundingBox())!.height - slot!.height)).toBeLessThanOrEqual(1);
  if (word.article) {
    const color = await back(page).locator(`.article-${word.article}`).evaluate((element) => getComputedStyle(element).color);
    const token = await page.evaluate((name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(--article-${name})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }, word.article);
    expect(color).toBe(token);
  }

  await next(page).click();
  await expect(back(page)).toHaveCount(0);
  await previous(page).click();
  await expect(back(page)).toHaveCount(0);
  await page.getByTestId('card-reveal').click();
  await page.getByTestId('card-direction').click();
  await expect(back(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.practice.cards.revealMeaning })).toBeVisible();

  await page.getByTestId('card-hide').click();
  await expect(back(page)).toBeVisible();
});

test('cards use the same word choice, and empty choices cannot start', async ({ page }) => {
  await pick(page, t.practice.studies.cards);
  await page.locator('.check-row').filter({ hasText: t.practice.favorites }).click();
  await expect(startCards(page)).toHaveAttribute('data-questions', '1');
  await page.locator('.check-row').filter({ hasText: 'Listem' }).click();
  await expect(startCards(page)).toHaveAttribute('data-questions', '2');
  await pick(page, '10');
  await startCards(page).click();
  await expect(position(page)).toHaveText('1 / 2');
  const fronts = [await front(page).innerText()];
  await next(page).click();
  fronts.push(await front(page).innerText());
  expect(fronts.sort()).toEqual(['das Haus', 'der Apfel']);
  await page.getByRole('button', { name: t.common.close }).click();
  await expect(page).toHaveURL(/#\/$/);

  // A collection whose words are all gone is not offered, and nothing chosen means nothing to start.
  await write(page, { words: [{ ...record(WORDS[2]!), deletedAt: 5 }] });
  await page.goto('./#/practice');
  await page.reload();
  await expect(page.locator('.check-row').filter({ hasText: 'Listem' })).toHaveCount(0);
  await expect(page.locator('.check-row').filter({ hasText: t.practice.difficult }).getByRole('checkbox')).toBeDisabled();
});

test('a word edited during the session shows its new text, and a deleted one leaves the cards', async ({ page }) => {
  await pick(page, t.practice.studies.cards);
  await startCards(page).click();
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    order.push(BY_FRONT.get(await front(page).innerText())!.id);
    if (i < 3) await next(page).click();
  }
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(position(page)).toHaveText('1 / 4');

  const [, second, third] = order;
  const edited = WORDS.find((word) => word.id === second)!;
  await write(page, { words: [{ ...record(edited), meanings: [{ text: 'yeni anlam', note: null }], updatedAt: 9 }, { ...record(WORDS.find((word) => word.id === third)!), deletedAt: 9 }] });

  await next(page).click();
  await expect(back(page)).toHaveText('yeni anlam');
  await next(page).click();
  await expect(position(page)).toHaveText('3 / 3');
  await expect(page.getByText(t.practice.cards.removed)).toBeVisible();
  expect(BY_FRONT.get(await front(page).innerText())!.id).toBe(order[3]);

  // A reload keeps the place, without the deleted word.
  await page.reload();
  await expect(position(page)).toHaveText('3 / 3');
  expect(await count(page, 'reviewLogs')).toBe(0);
});

test('Escape and close leave cards without asking, and arrow keys never move while typing elsewhere', async ({ page }) => {
  await pick(page, t.practice.studies.cards);
  await startCards(page).click();
  await expect(position(page)).toHaveText('1 / 4');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/$/);
  await page.goto('./#/practice');
  await expect(startCards(page)).toBeVisible();
  // On the setup screen, arrows belong to the radio groups.
  await page.getByRole('radio', { name: t.practice.studies.cards }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: t.practice.studies.typed })).toBeChecked();
});

for (const theme of ['light', 'dark'] as const) {
  test(`card study has no detectable accessibility problems in ${theme}`, async ({ page }) => {
    await page.evaluate((value) => localStorage.setItem('vosli.theme', value), theme);
    await page.reload();
    await pick(page, t.practice.studies.cards);
    await expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await startCards(page).click();
    await page.getByTestId('card-hide').click();
    await expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByTestId('card-reveal').click();
    await expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

for (const width of [320, 375, 430]) {
  test(`a ${width}px phone shows the whole card and both buttons without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await pick(page, t.practice.studies.cards);
    await startCards(page).click();
    await page.getByTestId('card-hide').click();
    for (const target of [page.getByTestId('card'), previous(page), next(page), page.getByTestId('card-hide')]) await expect(target).toBeInViewport({ ratio: 1 });
    const [left, right] = await Promise.all([previous(page).boundingBox(), next(page).boundingBox()]);
    expect(left!.y).toBe(right!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('at 200% text the controls wrap rather than clip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
  await pick(page, t.practice.studies.cards);
  await startCards(page).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await next(page).scrollIntoViewIfNeeded();
  await next(page).click();
  await expect(position(page)).toHaveText('2 / 4');
});
