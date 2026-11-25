import type { Page } from '@playwright/test';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { t } from '../src/i18n/strings';
import { tr } from '../src/i18n/tr';
import { buildPdf, tablePage } from '../tests/support/pdfBuilder';
import { expect, test } from './fixtures';

/** Two learning workspaces, German and English: separate words, collections and progress, and one switch between them. */

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

const GERMAN = [word('de-apfel', 'Apfel', 'der', 'elma', 'de'), word('de-also', 'also', null, 'yani', 'de'), word('de-haus', 'Haus', 'das', 'ev', 'de')];
const ENGLISH = [
  word('en-apple', 'apple', null, 'elma', 'en'),
  word('en-also', 'also', null, 'ayrıca', 'en'),
  word('en-pear', 'pear', null, 'armut', 'en'),
  word('en-plum', 'plum', null, 'erik', 'en'),
  word('en-grape', 'grape', null, 'üzüm', 'en'),
];

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

const read = (page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const rows = request.result.transaction(name).objectStore(name).getAll();
          rows.onsuccess = () => {
            request.result.close();
            resolve(rows.result as Record<string, unknown>[]);
          };
        };
      }),
    table,
  );

async function seeded(page: Page, hash = '#/dictionary') {
  await page.goto('./#/');
  await expect(page.locator('h1')).toBeVisible();
  await write(page, { words: [...GERMAN, ...ENGLISH] });
  await page.goto(`./${hash}`);
  await page.reload();
}

/** The learning-language row in Settings. Choosing asks first; confirming saves it and opens Home on that workspace. */
const switcher = (page: Page) => page.getByTestId('workspace-switcher');
const home = (page: Page) => page.getByTestId('home-workspace');
const confirmSwitch = (page: Page) => page.getByRole('dialog').getByRole('button', { name: t.workspace.switch });
const switchTo = async (page: Page, language: 'de' | 'en') => {
  await page.goto('./#/settings');
  // A plain click: the radio stays on the open workspace until the question is answered.
  await switcher(page).getByRole('radio', { name: t.lang[language].name }).click();
  await confirmSwitch(page).click();
  await expect(page).toHaveURL(/#\/$/);
  // Home names no language: its bunting is the workspace's own.
  await expect(page.locator(`.today-garland:visible .${language === 'en' ? 'flag-navy' : 'flag-black'}`)).toHaveCount(1);
};
async function inEnglish(page: Page, hash: string) {
  await seeded(page, '#/');
  await write(page, { meta: [{ key: 'learningLanguage', value: 'en' }] });
  await page.goto(`./${hash}`);
  await page.reload();
}
const savedLanguage = async (page: Page) => (await read(page, 'meta')).find((row) => row.key === 'learningLanguage')?.value;
const rowTitles = (page: Page) => page.locator('.list .row-title').allInnerTexts();

test('each workspace shows its own words, and the same spelling is a word in both', async ({ page }) => {
  await seeded(page);
  expect((await rowTitles(page)).sort()).toEqual(['also', 'der Apfel', 'das Haus'].sort());
  await switchTo(page, 'en');
  await expect(home(page)).toHaveText(t.home.workspace(5));
  await page.goto('./#/dictionary');
  await expect(page.locator('.list .row-title')).toHaveCount(5);
  expect((await rowTitles(page)).sort()).toEqual(['also', 'apple', 'grape', 'pear', 'plum']);
  await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', t.lang.en.search);
  // The choice is kept, and Settings shows it.
  await page.reload();
  await expect(page.locator('.list .row-title')).toHaveCount(5);
  await page.goto('./#/settings');
  await expect(switcher(page).getByRole('radio', { name: t.lang.en.name })).toBeChecked();
});

test('collections belong to their workspace', async ({ page }) => {
  await seeded(page, '#/collections');
  await switchTo(page, 'en');
  await page.goto('./#/collections');
  await page.getByRole('button', { name: t.collections.create }).first().click();
  await page.getByLabel(t.collections.listName).fill('Fruit');
  await page.getByLabel(t.collections.listName).press('Enter');
  await expect(page.locator('h1')).toHaveText('Fruit');
  const groups = await read(page, 'groups');
  expect(groups.map((group) => [group.name, group.language])).toEqual([['Fruit', 'en']]);
  await switchTo(page, 'de');
  await page.goto('./#/collections');
  await expect(page.locator('h1')).toHaveText(t.nav.collections);
  await expect(page.getByText('Fruit')).toHaveCount(0);
});

test('a new English word has no article and no German letters, and is saved as English', async ({ page }) => {
  await seeded(page);
  await switchTo(page, 'en');
  await page.goto('./#/dictionary/new');
  await expect(page.getByRole('textbox', { name: t.lang.en.word, exact: true })).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('group', { name: t.wordForm.article })).toHaveCount(0);
  await expect(page.getByRole('group', { name: t.wordForm.letters })).toHaveCount(0);
  await page.getByRole('textbox', { name: t.lang.en.word, exact: true }).fill('cherry');
  await page.getByRole('textbox', { name: t.lang.en.meaning, exact: true }).fill('kiraz');
  await page.getByRole('button', { name: t.common.save }).click();
  await expect(page.locator('h1')).toContainText('cherry');
  const saved = (await read(page, 'words')).find((row) => row.lemma === 'cherry')!;
  expect(saved).toMatchObject({ language: 'en', article: null });
});

test('a word of the other workspace is not there by its address', async ({ page }) => {
  await seeded(page);
  await switchTo(page, 'en');
  await page.goto('./#/dictionary/de-apfel');
  await expect(page.locator('h1')).toHaveText(t.dictionary.notFound);
  await page.goto('./#/dictionary/de-apfel/edit');
  await expect(page.locator('h1')).toHaveText(t.dictionary.notFound);
});

test('a word of the open workspace opens by its address, after a reload too', async ({ page }) => {
  await seeded(page);
  await switchTo(page, 'en');
  await page.goto('./#/dictionary/en-apple');
  await page.reload();
  await expect(page.locator('h1')).toHaveText('apple');
  await expect(page).toHaveURL(/#\/dictionary\/en-apple$/u);
});

test('unsaved work holds the workspace, here and in another tab, until it is done', async ({ page, context }) => {
  await seeded(page);
  const other = await context.newPage();
  await other.goto('./#/dictionary/new');
  await other.getByRole('textbox', { name: t.lang.de.word, exact: true }).fill('Birne');

  await switchTo(page, 'en');
  // The other tab keeps the German form and its text.
  await expect(other.getByRole('textbox', { name: t.lang.de.word, exact: true })).toHaveValue('Birne');
  await expect(other.getByRole('textbox', { name: t.lang.de.word, exact: true })).toBeVisible();
  // Once nothing would be lost, it follows.
  await other.getByRole('textbox', { name: t.lang.de.word, exact: true }).fill('');
  // A new German word's page has no meaning in English, so the tab goes to the English list instead.
  await expect(other).toHaveURL(/#\/dictionary$/);
  await expect(other.locator('.list .row-title')).toHaveCount(5);
});

test('Settings keeps the two languages apart, and Home shows which workspace is open', async ({ page }) => {
  await seeded(page, '#/settings');
  await expect(switcher(page).getByRole('radio', { name: t.lang.de.name })).toBeChecked();
  // The interface language is a setting of its own: switching what is learned leaves it as it was.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await switchTo(page, 'en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => localStorage.getItem('vosli.locale'))).toBeNull();
  await page.goto('./#/settings');
  const row = (await switcher(page).getByRole('radio', { name: t.lang.de.name }).locator('..').boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(44);
  await switchTo(page, 'de');
  await expect(home(page)).toHaveText(t.home.workspace(3));
});

test('switching asks first: Cancel keeps the workspace and what is selected, Switch keeps the choice', async ({ page }) => {
  await seeded(page, '#/settings');
  const german = switcher(page).getByRole('radio', { name: t.lang.de.name });
  const english = switcher(page).getByRole('radio', { name: t.lang.en.name });
  const dialog = page.getByRole('dialog');

  await english.click();
  await expect(dialog.getByRole('heading')).toHaveText(t.lang.en.switchTitle);
  await expect(dialog).toContainText(t.lang.en.switchKeeps);
  // Behind the question the open workspace is still the one selected, and Cancel holds the focus.
  await expect(german).toBeChecked();
  await expect(english).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: t.common.cancel })).toBeFocused();
  await dialog.getByRole('button', { name: t.common.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(german).toBeChecked();
  await expect(english).not.toBeChecked();
  // Escape is Cancel too, and focus goes back to the radio that asked.
  await english.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(german).toBeChecked();
  await expect(english).toBeFocused();
  // Nothing was saved: a reload is still German, here and on Home.
  await page.reload();
  await expect(german).toBeChecked();
  expect(await savedLanguage(page)).not.toBe('en');

  await english.click();
  await confirmSwitch(page).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(home(page)).toHaveText(t.home.workspace(5));
  expect(await savedLanguage(page)).toBe('en');
  await page.reload();
  await expect(home(page)).toHaveText(t.home.workspace(5));
  await page.goto('./#/settings');
  await expect(english).toBeChecked();
  // The way back asks in its own words.
  await german.click();
  await expect(dialog.getByRole('heading')).toHaveText(t.lang.de.switchTitle);
  await expect(dialog).toContainText(t.lang.de.switchKeeps);
});

test('Home is drawn for the open workspace: Berlin and its flags for German, London and the Union Jack colors for English', async ({ page }) => {
  const flagClasses = () => page.locator('.today-garland:visible path:not(.flag-string)').evaluateAll((paths) => paths.map((path) => path.getAttribute('class')));
  const far = () => page.locator('.today-scene-art .scene-far').getAttribute('d');
  await seeded(page, '#/');
  await expect(page.locator('.today-garland:visible')).toHaveCount(1);
  expect(await flagClasses()).toEqual(['flag-black', 'flag-red', 'flag-gold', 'flag-cream']);
  const berlin = await far();
  // A real switch, so the city follows without a reload.
  await switchTo(page, 'en');
  await expect(page.locator('.today-garland:visible')).toHaveCount(1);
  expect(await flagClasses()).toEqual(['flag-navy', 'flag-crimson', 'flag-white']);
  const london = await far();
  expect(london).not.toBe(berlin);
  // Same frame and stage, and still only decoration.
  await expect(page.locator('.today-scene-art')).toHaveAttribute('viewBox', '0 0 1600 240');
  await expect(page.locator('.today-scene-art')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.today-bunting')).toHaveAttribute('aria-hidden', 'true');
  for (const flag of ['flag-navy', 'flag-crimson', 'flag-white']) {
    expect(await page.locator(`.today-garland:visible .${flag}`).evaluate((path) => getComputedStyle(path).fill)).not.toBe('none');
  }
  await switchTo(page, 'de');
  expect(await flagClasses()).toEqual(['flag-black', 'flag-red', 'flag-gold', 'flag-cream']);
  expect(await far()).toBe(berlin);
});

test('article colors are a German setting: hidden in English, kept as they were', async ({ page }) => {
  await seeded(page, '#/settings');
  const toggle = page.getByTestId('article-colors');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await switchTo(page, 'en');
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.settings.title);
  await expect(toggle).toHaveCount(0);
  await expect(page.getByText(t.settings.articleColors, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('vosli.article-colors'))).toBe('on');
  await switchTo(page, 'de');
  await page.goto('./#/settings');
  await expect(toggle).toBeChecked();
});

for (const [locale, strings] of [['en', en], ['tr', tr], ['de', de]] as const) {
  test(`the paste example and the sources belong to the open workspace, in ${locale}`, async ({ page }) => {
    await page.goto('./#/');
    await page.evaluate((chosen) => localStorage.setItem('vosli.locale', chosen), locale);
    await seeded(page, '#/import');
    const paste = page.locator('#import-text');
    // Sources: the same two rows in both workspaces, Wiktionary then Commons; only the first row's title differs.
    const sources = async (title: string) => {
      await page.goto('./#/settings');
      const rows = page.locator('.source-credit');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).locator('.row-title')).toHaveText(title);
      await expect(rows.nth(0).getByRole('link', { name: strings.settings.dictionarySource })).toHaveAttribute('href', 'https://de.wiktionary.org/');
      await expect(rows.nth(0).getByRole('link', { name: strings.settings.dictionaryLicense })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
      await expect(rows.nth(1).locator('.row-title')).toHaveText(strings.settings.pronunciationData);
      await expect(rows.nth(1).getByRole('link', { name: strings.settings.pronunciationSource })).toHaveAttribute('href', 'https://commons.wikimedia.org/');
      await expect(rows.nth(1)).toContainText(strings.settings.pronunciationLicenses);
      await expect(rows.nth(1).getByTestId('pronunciation-privacy')).toHaveText(strings.settings.pronunciationPrivacy);
      return rows;
    };

    // German: German words; its dictionary and recording list.
    await expect(paste).toHaveAttribute('placeholder', strings.lang.de.pastePlaceholder);
    const german = await sources(strings.settings.dictionaryData);
    const germanBoxes = await german.evaluateAll((rows) => rows.map((row) => [row.getBoundingClientRect().height, getComputedStyle(row.querySelector('.row-title')!).fontSize]));

    // English: English words; only a recording list, never a dictionary, laid out exactly as German's.
    await write(page, { meta: [{ key: 'learningLanguage', value: 'en' }] });
    await page.goto('./#/import');
    await page.reload();
    await expect(paste).toHaveAttribute('placeholder', strings.lang.en.pastePlaceholder);
    // The words are English; their meanings may be in any language, here the interface's.
    expect(strings.lang.en.pastePlaceholder.split('\n').map((line) => line.split(' - ')[0])).toEqual(['apple', 'give up', 'bank']);
    const english = await sources(strings.settings.recordingList);
    await expect(page.getByText(strings.settings.dictionaryData, { exact: true })).toHaveCount(0);
    const englishBoxes = await english.evaluateAll((rows) => rows.map((row) => [row.getBoundingClientRect().height, getComputedStyle(row.querySelector('.row-title')!).fontSize]));
    expect(englishBoxes.map(([, size]) => size)).toEqual(germanBoxes.map(([, size]) => size));
    expect(englishBoxes[1]).toEqual(germanBoxes[1]);
  });
}

test.describe('importing into English', () => {
  const rows = (page: Page) => page.getByTestId('review-row');
  const reviewHeading = (page: Page) => expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.reviewTitle, { timeout: 30_000 });
  const filter = (page: Page) => page.getByRole('group', { name: t.import.filterLabel });
  const csv = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
  async function commit(page: Page) {
    await page.locator('.review-commit .btn-primary').click();
    await page.getByRole('dialog').getByRole('button', { name: t.common.save }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.doneTitle);
  }
  const saved = async (page: Page, lemma: string) => (await read(page, 'words')).find((row) => row.lemma === lemma);

  test('a CSV shows every row at once, with no German columns, and saves English words', async ({ page }) => {
    await inEnglish(page, '#/import');
    await page.locator('input[type=file]').setInputFiles(csv('words.csv', 'English;Article;Türkçe;Plural\r\nmouse;the;fare;mice\r\napple;;elma;apples\r\ngive up;;;\r\n'));
    await reviewHeading(page);
    // No filter: every row is there, the one missing its meaning too, saying so, and it can still be excluded at once.
    await expect(filter(page)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: t.import.filterAll })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2)).toContainText(t.lang.en.importMeaningMissing);
    await expect(page.getByRole('button', { name: t.import.excludeProblems })).toBeVisible();
    // The Article and Plural columns were not used: the word is its own text, and editing it has no article.
    await expect(rows(page).first()).toContainText('mouse');
    await expect(rows(page).first()).not.toContainText('the');
    await rows(page).first().getByRole('button', { name: t.import.editRow('mouse') }).click();
    await expect(rows(page).first().getByLabel(t.lang.en.word)).toHaveValue('mouse');
    await expect(rows(page).first().getByLabel(t.import.articleField)).toHaveCount(0);
    // A row that cannot be saved holds the save until it is fixed or left out, as in German.
    await expect(page.locator('.review-commit .btn-primary')).toBeDisabled();
    await page.getByRole('button', { name: t.import.excludeProblems }).click();
    await expect(rows(page)).toHaveCount(3);
    await commit(page);
    expect(await saved(page, 'mouse')).toMatchObject({ language: 'en', article: null, plural: null, meanings: [{ text: 'fare' }] });
    expect(await saved(page, 'apple')).toMatchObject({ language: 'en', article: null, plural: null });
    expect(await saved(page, 'give up')).toBeUndefined();
  });

  test('choosing columns offers only the word, its meaning, or neither', async ({ page }) => {
    await inEnglish(page, '#/import');
    await page.locator('input[type=file]').setInputFiles(csv('table.csv', 'x,peach,şeftali,y\nx,cherry,kiraz,y\n'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.import.mapTitle);
    await expect(page.getByLabel(t.import.column(1)).locator('option')).toHaveText([t.lang.en.word, t.lang.en.meaning, t.import.roles.ignore]);
    await page.getByLabel(t.import.column(1)).selectOption('ignore');
    await page.getByLabel(t.import.column(2)).selectOption('german');
    await page.getByLabel(t.import.column(3)).selectOption('turkish');
    await page.getByRole('button', { name: t.import.next }).click();
    await reviewHeading(page);
    await expect(filter(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
  });

  test('a PDF shows every row at once and keeps its settings, editing, exclusion and saving', async ({ page }) => {
    await inEnglish(page, '#/import');
    const bytes = buildPdf([tablePage([['apple', '', 'elma'], ['pear', '', ''], ['cherry', '', 'kiraz'], ['peach', '', 'şeftali']], { heading: 'Unit 1' })]);
    await page.locator('input[type=file]').setInputFiles({ name: 'unit-1.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await reviewHeading(page);
    await expect(page.locator('.eyebrow')).toHaveText(`${t.lang.en.name} · unit-1.pdf`);
    await expect(filter(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).nth(1)).toContainText(t.lang.en.importMeaningMissing);
    // The PDF's own settings are still there.
    await expect(page.getByRole('button', { name: t.import.pdfSettings })).toBeVisible();
    // A row that cannot be saved opens for fixing by itself; another row is left out by hand.
    await rows(page).nth(1).getByLabel(t.lang.en.meaning).fill('armut');
    await expect(rows(page).nth(1)).not.toContainText(t.lang.en.importMeaningMissing);
    await rows(page).nth(3).locator('.review-check input').uncheck();
    await expect(rows(page)).toHaveCount(4);
    await commit(page);
    expect(await saved(page, 'pear')).toMatchObject({ language: 'en', article: null, meanings: [{ text: 'armut' }] });
    expect(await saved(page, 'apple')).toMatchObject({ language: 'en' });
    expect(await saved(page, 'peach')).toBeUndefined();
  });
});

test.describe('studying English', () => {
  const pick = (page: Page, name: string) => page.locator('.segmented label').filter({ hasText: new RegExp(`^${name}$`) }).click();
  const answerFor = (prompt: string, cue: string) => {
    const hit = ENGLISH.find((entry) => entry.lemma === prompt || entry.meanings[0]!.text === prompt)!;
    return cue === t.lang.en.cue.de_tr ? hit.meanings[0]!.text : hit.lemma;
  };

  test('offers Listening but no article questions, while German keeps both', async ({ page }) => {
    await inEnglish(page, '#/practice');
    await expect(page.getByRole('radio', { name: t.practice.studies.listen })).toHaveCount(1);
    await expect(page.getByRole('radio', { name: t.practice.modes.article })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: t.lang.en.directions.tr_de })).toHaveCount(1);
    await write(page, { meta: [{ key: 'learningLanguage', value: 'de' }] });
    await page.reload();
    await expect(page.getByRole('radio', { name: t.practice.studies.listen })).toHaveCount(1);
    await expect(page.getByRole('radio', { name: t.practice.modes.article })).toHaveCount(1);
  });

  test('typing asks English words only, checks them the English way, and comes back after a reload', async ({ page }) => {
    await inEnglish(page, '#/practice');
    await pick(page, t.lang.en.directions.tr_de);
    await page.getByRole('button', { name: t.practice.start }).click();
    const question = page.getByTestId('practice-question');
    await expect(question).toBeVisible();
    await expect(page.locator('.letters')).toHaveCount(0);
    await expect(page.getByTestId('practice-cue')).toHaveText(t.lang.en.cue.tr_de);
    const prompt = await question.innerText();
    expect(ENGLISH.map((entry) => entry.meanings[0]!.text)).toContain(prompt);
    // A capital is no mistake in English.
    const answer = answerFor(prompt, t.lang.en.cue.tr_de);
    await page.getByLabel(t.practice.answerLabel).fill(answer.toUpperCase().slice(0, 1) + answer.slice(1));
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('practice-feedback')).toContainText(t.practice.correct);
    const logs = await read(page, 'reviewLogs');
    expect(logs).toHaveLength(1);
    expect(String(logs[0]!.wordId)).toMatch(/^en-/);
    await page.reload();
    await expect(page.getByTestId('practice-feedback')).toBeVisible();
  });

  test('flashcards show English words, tagged as English', async ({ page }) => {
    await inEnglish(page, '#/practice');
    await pick(page, t.practice.studies.cards);
    await page.getByRole('button', { name: t.practice.startCards }).click();
    const front = page.getByTestId('card-front');
    await expect(front).toHaveAttribute('lang', 'en');
    expect(ENGLISH.map((entry) => entry.lemma)).toContain(await front.innerText());
  });

  test('a test draws every option from English words and never asks an article', async ({ page }) => {
    await inEnglish(page, '#/practice');
    await pick(page, t.practice.studies.test);
    await page.getByRole('button', { name: t.practice.test.start }).click();
    const options = page.getByTestId('test-option');
    await expect(options).toHaveCount(4);
    const lemmas = ENGLISH.map((entry) => entry.lemma);
    const meanings = ENGLISH.map((entry) => entry.meanings[0]!.text);
    for (const text of await options.locator('.choice-text').allInnerTexts()) {
      expect([...lemmas, ...meanings]).toContain(text.trim());
      expect(['der', 'die', 'das']).not.toContain(text.trim());
    }
  });

  test('Smart Review schedules English words only, and leaves German schedules as they were', async ({ page }) => {
    await inEnglish(page, '#/');
    const german = { wordId: 'de-apfel', track: 'de_tr', due: 1, fsrs: { stability: 1, difficulty: 5, dueAt: 1, lastReviewAt: null, state: 2, scheduleStatus: 'review', reps: 3, lapses: 0, scheduledDays: 1, learningStep: 0 }, schedulerVersion: 'ts-fsrs@6.0.0/FSRS-6/v1' };
    await write(page, { cards: [german] });
    await page.goto('./#/review');
    await page.reload();
    const question = page.getByTestId('practice-question');
    await expect(question).toBeVisible();
    const cue = await page.getByTestId('practice-cue').innerText();
    await page.getByLabel(t.practice.answerLabel).fill(answerFor(await question.innerText(), cue));
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('practice-feedback')).toBeVisible();
    const cards = await read(page, 'cards');
    expect(cards.find((card) => card.wordId === 'de-apfel')).toEqual(german);
    expect(cards.filter((card) => card.wordId !== 'de-apfel').every((card) => String(card.wordId).startsWith('en-'))).toBe(true);
    expect(cards.length).toBe(2);
  });
});
