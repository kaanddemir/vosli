import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';

async function open(page: Page, hash = '#/') {
  await page.goto(`./${hash}`);
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const main = (page: Page) => page.getByRole('main');

const makeWord = (id: string, lemma: string, article: string | null, meanings: string[], extra: Record<string, unknown> = {}) => ({ id, identityKey: `${lemma}|${article ?? ''}`, lemma, article, pos: article ? 'noun' : 'other', plural: null, meanings: meanings.map((text) => ({ text, note: null })), senseTag: null, searchTokens: [], favoritedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null, ...extra });
const fsrs = { stability: 3, difficulty: 5, dueAt: 9_999_999_999_999, lastReviewAt: 5, state: 2, scheduleStatus: 'review', reps: 4, lapses: 1, scheduledDays: 10, learningStep: 0 };

const longLemma = 'Donaudampfschifffahrtsgesellschaftskapitänsmütze';
const longMeaning = 'Tuna buharlı gemi işletmeciliği şirketi kaptanının şapkası, uzun bir Türkçe karşılık';
const longList = 'Bölüm 1 — Kelime listesi 2026 (son hali, düzeltilmiş) kopya';

const LIBRARY = {
  words: [
    makeWord('apfel', 'Apfel', 'der', ['elma'], { favoritedAt: 2 }),
    makeWord('fuss', 'Fuß', 'der', ['ayak']),
    makeWord('see', 'See', 'der', ['göl']),
    makeWord('long', longLemma, 'die', [longMeaning]),
    makeWord('essen', 'Essen', 'das', ['yemek']),
  ],
  cards: [{ wordId: 'apfel', track: 'de_tr', due: fsrs.dueAt, fsrs, schedulerVersion: 'fsrs-6' }],
  reviewLogs: [{ seq: 1, mode: 'practice', wordId: 'apfel', track: 'de_tr', at: 5, typed: 'elma', result: 'correct', hintsUsed: 0 }],
  sources: [{ id: 's1', fileName: 'bolum-1.pdf', fileHash: 'h1', importedAt: 1_780_000_000_000, pipelineVersion: 1 }],
  groups: [
    { id: 'g-pdf', kind: 'pdf', name: 'bolum-1.pdf', order: 0, sourceId: 's1', createdAt: 1 },
    { id: 'g-a', kind: 'custom', name: 'Zor', order: 1, sourceId: null, createdAt: 1 },
    { id: 'g-b', kind: 'custom', name: longList, order: 2, sourceId: null, createdAt: 1 },
  ],
  groupMembers: [
    { groupId: 'g-pdf', wordId: 'apfel', addedAt: 1, importRowId: 'r1' },
    { groupId: 'g-a', wordId: 'apfel', addedAt: 1, importRowId: null },
    { groupId: 'g-a', wordId: 'long', addedAt: 1, importRowId: null },
    { groupId: 'g-b', wordId: 'apfel', addedAt: 1, importRowId: null },
  ],
  importRows: [{ id: 'r1', sourceId: 's1', page: 1, rowIndex: 0, german: 'Apfel', article: 'der', turkish: 'elma', flags: [], decision: 'new', wordId: 'apfel' }],
};

async function seed(page: Page, data: Record<string, unknown[]> = LIBRARY) {
  await page.evaluate(
    (tables) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(Object.keys(tables), 'readwrite');
          for (const [table, rows] of Object.entries(tables)) for (const row of rows) tx.objectStore(table).put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    data,
  );
}

const dump = (page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('vosli');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction(name).objectStore(name).getAll();
          read.onsuccess = () => {
            db.close();
            resolve(read.result as Record<string, unknown>[]);
          };
        };
      }),
    table,
  );

async function seeded(page: Page, hash: string) {
  await open(page);
  await seed(page);
  await open(page, hash);
}

const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));

async function axe(page: Page, label: string) {
  await settled(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map((v) => `${label}: ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}

const overflowing = (page: Page) =>
  page.evaluate(() => {
    const opticalOverhang = (el: Element) => {
      const button = el.querySelector('.page-actions .icon-btn');
      if (!button || !button.getBoundingClientRect().width) return 0;
      return (button.getBoundingClientRect().width - (button.querySelector('svg')?.getBoundingClientRect().width ?? 0)) / 2;
    };
    return [...document.querySelectorAll('body *')]
      .filter((el) => !el.closest('.visually-hidden, .skip-link') && !el.matches('.visually-hidden, input, select, textarea, option, svg, svg *'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        const pastEdge = box.width > 0 && box.right > document.documentElement.clientWidth + 0.5;
        const spills = el.scrollWidth > el.clientWidth + 1 + opticalOverhang(el) && getComputedStyle(el).display !== 'inline';
        return pastEdge || spills;
      })
      .map((el) => `${el.tagName}.${el.className}`);
  });

const fillWord = async (page: Page, german: string, turkish: string) => {
  await page.getByLabel(t.wordForm.german, { exact: true }).fill(german);
  await page.getByLabel(t.wordForm.turkish, { exact: true }).fill(turkish);
};
const save = (scope: Page | Locator) => scope.getByRole('button', { name: t.common.save, exact: true }).click();

test.describe('manual vocabulary', () => {
  test('adds a word from the empty dictionary and finds it again', { tag: '@smoke' }, async ({ page }) => {
    await open(page, '#/dictionary');
    await page.getByRole('link', { name: t.dictionary.addWord }).click();
    await expect(heading(page)).toHaveText(t.wordForm.newTitle);
    await fillWord(page, 'der Apfel', 'elma, alma');
    await save(page);
    await expect(heading(page)).toHaveText('der Apfel');
    await expect(main(page)).toContainText('elma');
    await expect(main(page)).toContainText('alma');
    const [word] = await dump(page, 'words');
    expect(word).toMatchObject({ lemma: 'Apfel', article: 'der', pos: 'noun', identityKey: 'Apfel|der' });
    await main(page).getByRole('link', { name: t.nav.dictionary }).click();
    await expect(page.getByRole('link', { name: /der Apfel/ })).toBeVisible();
  });

  test('requires both fields and moves focus to the first problem', async ({ page }) => {
    await open(page, '#/dictionary/new');
    await save(page);
    await expect(page.getByText(t.wordForm.errors.german_missing)).toBeVisible();
    await expect(page.getByLabel(t.wordForm.german, { exact: true })).toBeFocused();
    await expect(page.getByLabel(t.wordForm.german, { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('Apfel');
    await save(page);
    await expect(page.getByText(t.wordForm.errors.turkish_missing)).toBeVisible();
    await expect(page.getByLabel(t.wordForm.turkish, { exact: true })).toBeFocused();
    expect(await dump(page, 'words')).toEqual([]);
  });

  test('the article control and German letters work', async ({ page }) => {
    await open(page, '#/dictionary/new');
    await page.getByRole('radio', { name: 'die', exact: true }).check();
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('Gr');
    await page.getByRole('button', { name: t.wordForm.insert('ö') }).click();
    await page.getByRole('button', { name: t.wordForm.insert('ß') }).click();
    await expect(page.getByLabel(t.wordForm.german, { exact: true })).toHaveValue('Größ');
    await page.getByLabel(t.wordForm.german, { exact: true }).pressSequentially('e');
    await page.getByLabel(t.wordForm.turkish, { exact: true }).fill('boy');
    await page.getByLabel(t.wordForm.plural).fill('die Größen');
    await save(page);
    await expect(heading(page)).toHaveText('die Größe');
    await expect(main(page)).toContainText('die Größen');
  });

  test('stops an exact duplicate and links to the existing word', async ({ page }) => {
    await seeded(page, '#/dictionary/new');
    await fillWord(page, 'der Apfel', 'elma');
    await save(page);
    const panel = page.getByRole('alert');
    await expect(panel).toContainText(t.wordForm.exists);
    await expect(panel).toBeFocused();
    expect((await dump(page, 'words')).length).toBe(5);
    await panel.getByRole('link', { name: /der Apfel/ }).click();
    await expect(heading(page)).toHaveText('der Apfel');
  });

  test('offers to add a new meaning, or keep a homonym separate', async ({ page }) => {
    await seeded(page, '#/dictionary/new');
    await fillWord(page, 'der Apfel', 'elma, alma');
    await save(page);
    await page.getByRole('button', { name: t.wordForm.addMeaning }).click();
    await expect(heading(page)).toHaveText('der Apfel');
    await expect(main(page)).toContainText('alma');

    await page.goto('./#/dictionary/new');
    await fillWord(page, 'der See', 'deniz');
    await save(page);
    const panel = page.getByRole('alert');
    await expect(panel).toContainText(t.wordForm.reasons.meaning);
    await panel.getByRole('button', { name: t.wordForm.separate }).click();
    await expect(heading(page)).toHaveText('der See');
    expect((await dump(page, 'words')).filter((word) => word.lemma === 'See').length).toBe(2);
  });

  test('keeps essen and das Essen as separate entries without asking', async ({ page }) => {
    await seeded(page, '#/dictionary/new');
    await fillWord(page, 'essen', 'yemek yemek');
    await save(page);
    await expect(heading(page)).toHaveText('essen');
    const words = await dump(page, 'words');
    expect(words.filter((word) => String(word.lemma).toLowerCase() === 'essen').map((word) => word.identityKey).sort()).toEqual(['Essen|das', 'essen|']);
  });

  test('asks before adding the same noun with another article', async ({ page }) => {
    await seeded(page, '#/dictionary/new');
    await fillWord(page, 'die See', 'göl');
    await save(page);
    await expect(page.getByRole('alert')).toContainText(t.wordForm.reasons.article);
    expect((await dump(page, 'words')).filter((word) => word.lemma === 'See').length).toBe(1);
  });

  test('editing keeps the id and all learning history', async ({ page }) => {
    await seeded(page, '#/dictionary/apfel');
    const [cards, logs] = [await dump(page, 'cards'), await dump(page, 'reviewLogs')];
    await page.getByRole('link', { name: t.dictionary.edit }).click();
    await expect(heading(page)).toHaveText(t.wordForm.editTitle);
    await expect(page.getByLabel(t.wordForm.turkish, { exact: true })).toHaveValue('elma');
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('Äpfelchen');
    await page.getByRole('radio', { name: 'das', exact: true }).check();
    await save(page);
    await expect(heading(page)).toHaveText('das Äpfelchen');
    expect(page.url()).toContain('#/dictionary/apfel');
    expect(await dump(page, 'cards')).toEqual(cards);
    expect(await dump(page, 'reviewLogs')).toEqual(logs);
  });

  test('editing cannot take the identity of another word', async ({ page }) => {
    await seeded(page, '#/dictionary/fuss/edit');
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('Apfel');
    await save(page);
    await expect(page.getByRole('alert')).toContainText(t.wordForm.exists);
    expect((await dump(page, 'words')).find((word) => word.id === 'fuss')?.lemma).toBe('Fuß');
  });

  test('favorites toggle, show in the list and filter it', async ({ page }) => {
    await seeded(page, '#/dictionary/fuss');
    const star = page.getByRole('button', { name: t.dictionary.favoriteOn });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(page.getByRole('button', { name: t.dictionary.favoriteOff })).toHaveAttribute('aria-pressed', 'true');
    await open(page, '#/dictionary');
    await page.getByRole('radio', { name: t.dictionary.filterFavorites }).check();
    await expect(page.locator('.row-press')).toHaveCount(2);
    await page.getByRole('searchbox', { name: t.dictionary.searchLabel }).fill('ayak');
    await expect(page.locator('.row-press')).toHaveCount(1);
    await page.getByRole('searchbox', { name: t.dictionary.searchLabel }).fill('');
    await page.getByRole('radio', { name: t.dictionary.filterAll }).check();
    await expect(page.locator('.row-press')).toHaveCount(5);
  });

  test('an empty favorites filter says so', async ({ page }) => {
    await open(page);
    await seed(page, { words: [makeWord('a', 'Fuß', 'der', ['ayak'])] });
    await open(page, '#/dictionary');
    await page.getByRole('radio', { name: t.dictionary.filterFavorites }).check();
    await expect(page.getByText(t.dictionary.noFavorites)).toBeVisible();
  });

  test('searches German and Turkish, in any case', async ({ page }) => {
    await seeded(page, '#/dictionary');
    const search = page.getByRole('searchbox', { name: t.dictionary.searchLabel });
    await search.fill('FUSS');
    await expect(page.locator('.row-press')).toHaveCount(1);
    await search.fill('AYAK');
    await expect(page.locator('.row-press').first()).toContainText('Fuß');
  });

  test('deleting asks first and removes the word with its history; adding it back starts fresh', { tag: '@smoke' }, async ({ page }) => {
    await seeded(page, '#/dictionary/apfel');
    await page.getByRole('button', { name: t.dictionary.deleteWord }).click();
    const dialog = page.getByRole('dialog', { name: t.dictionary.deleteTitle('der Apfel') });
    await expect(dialog.getByRole('button', { name: t.common.cancel })).toBeFocused();
    await dialog.getByRole('button', { name: t.common.cancel }).click();
    await expect(heading(page)).toHaveText('der Apfel');
    expect((await dump(page, 'words')).find((word) => word.id === 'apfel')?.deletedAt).toBeNull();

    await page.getByRole('button', { name: t.dictionary.deleteWord }).click();
    await page.getByRole('dialog').getByRole('button', { name: t.common.delete }).click();
    await expect(heading(page)).toHaveText(t.dictionary.title);
    await expect(page.getByRole('link', { name: /der Apfel/ })).toHaveCount(0);
    for (const table of ['words', 'cards', 'reviewLogs', 'groupMembers', 'importRows']) expect(JSON.stringify(await dump(page, table))).not.toContain('"apfel"');

    await page.getByRole('link', { name: t.dictionary.addWord }).click();
    await fillWord(page, 'der Apfel', 'elma');
    await save(page);
    await expect(heading(page)).toHaveText('der Apfel');
    expect(page.url()).not.toContain('#/dictionary/apfel');
    await expect(main(page)).not.toContainText('bolum-1.pdf');
  });

  test('a word shows its collections and sources', async ({ page }) => {
    await seeded(page, '#/dictionary/apfel');
    await expect(page.getByRole('link', { name: /bolum-1\.pdf/ })).toContainText(t.collections.kind.pdf);
    await expect(page.getByRole('link', { name: /Zor/ })).toContainText(t.collections.kind.custom);
    await expect(page.getByRole('heading', { name: t.dictionary.sources })).toBeVisible();
  });
});

test.describe('collections', () => {
  test('creates a list, adds words with search, and counts them', { tag: '@smoke' }, async ({ page }) => {
    await seeded(page, '#/collections');
    await page.getByRole('button', { name: t.collections.create }).click();
    const dialog = page.getByRole('dialog', { name: t.collections.create });
    await expect(dialog.getByLabel(t.collections.listName)).toBeFocused();
    await dialog.getByLabel(t.collections.listName).fill('zor');
    await save(dialog);
    await expect(dialog).toContainText(t.collections.nameErrors.taken);
    await dialog.getByLabel(t.collections.listName).fill('Şarkılar');
    await save(dialog);
    await expect(heading(page)).toHaveText('Şarkılar');

    await page.getByRole('button', { name: t.collections.addWords }).click();
    const picker = page.getByRole('dialog');
    await expect(picker.getByRole('button', { name: t.collections.addSelected('0') })).toBeDisabled();
    await picker.getByRole('searchbox').fill('ayak');
    await picker.getByRole('checkbox').check();
    await picker.getByRole('searchbox').fill('');
    await picker.getByRole('checkbox', { name: /Essen/ }).check();
    await picker.getByRole('button', { name: t.collections.addSelected('2') }).click();
    await expect(page.locator('.list .row-press')).toHaveCount(4); // Two words, rename, delete.
    await expect(main(page)).toContainText(t.common.words('2'));
    await page.getByRole('main').getByRole('link', { name: t.nav.collections }).click();
    await expect(page.getByRole('link', { name: /Şarkılar/ })).toContainText('2');
  });

  test('removing from a list keeps the word elsewhere, and can be undone', async ({ page }) => {
    await seeded(page, '#/collections/g-a');
    const before = (await dump(page, 'groupMembers')).find((m) => m.groupId === 'g-a' && m.wordId === 'apfel');
    const others = ['words', 'cards', 'reviewLogs'];
    const kept = await Promise.all(others.map((table) => dump(page, table)));
    // Rows open their word as before; nothing on them removes it.
    await expect(main(page).getByRole('button', { name: /listeden/i })).toHaveCount(0);
    await page.getByRole('button', { name: t.common.select }).click();
    await expect(page.getByRole('button', { name: t.collections.removeSelected })).toBeDisabled();
    await expect(page.getByRole('button', { name: t.common.delete, exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: /Apfel/ }).check();
    await expect(page.getByRole('status').filter({ hasText: t.common.selected('1') })).toBeVisible();
    await page.getByRole('button', { name: t.collections.removeSelected }).click();
    await expect(page.getByRole('status').filter({ hasText: t.collections.removed('der Apfel') })).toBeVisible();
    await expect(main(page)).toContainText(t.common.words('1'));
    // Selection ends, and focus goes back to the button that began it.
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t.common.select })).toBeFocused();
    const members = await dump(page, 'groupMembers');
    expect(members.filter((m) => m.wordId === 'apfel').map((m) => m.groupId).sort()).toEqual(['g-b', 'g-pdf']);
    expect(await Promise.all(others.map((table) => dump(page, table)))).toEqual(kept);
    await page.getByRole('button', { name: t.common.undo }).click();
    await expect(main(page)).toContainText(t.common.words('2'));
    expect((await dump(page, 'groupMembers')).find((m) => m.groupId === 'g-a' && m.wordId === 'apfel')).toEqual(before);
  });

  test('takes several words out at once with the keyboard, and undoes them together', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop keyboard flow');
    await seeded(page, '#/collections/g-a');
    const before = await dump(page, 'groupMembers');
    await page.getByRole('button', { name: t.common.select }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: t.common.cancel })).toBeFocused();
    await page.getByRole('button', { name: t.common.selectAll }).click();
    await expect(page.getByRole('status').filter({ hasText: t.common.selected('2') })).toBeVisible();
    // The list's own actions step aside while choosing, so deleting the list is never beside taking words out.
    await expect(page.getByRole('button', { name: t.collections.deleteList })).toHaveCount(0);
    await page.getByRole('button', { name: t.collections.removeSelected }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: t.collections.removedMany('2') })).toBeVisible();
    await expect(page.getByText(t.collections.emptyGroup)).toBeVisible();
    await expect(page.getByRole('link', { name: t.collections.createWord })).toBeVisible();
    await page.getByRole('button', { name: t.common.undo }).click();
    await expect(main(page)).toContainText(t.common.words('2'));
    expect(await dump(page, 'groupMembers')).toEqual(before);
    await page.getByRole('button', { name: t.common.select }).click();
    await page.getByRole('button', { name: t.common.cancel }).click();
    await expect(page.getByRole('button', { name: t.collections.deleteList })).toBeVisible();
    await expect(page.getByRole('link', { name: /Apfel/ })).toHaveAttribute('href', '#/collections/g-a/apfel');
  });

  test('renames a list', async ({ page }) => {
    await seeded(page, '#/collections/g-a');
    await page.getByRole('button', { name: t.collections.renameList }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(t.collections.listName)).toHaveValue('Zor');
    await dialog.getByLabel(t.collections.listName).fill('Çok zor');
    await save(dialog);
    await expect(heading(page)).toHaveText('Çok zor');
    await expect(page.getByRole('button', { name: t.collections.renameList })).toBeVisible();
  });

  test('deleting a list keeps its words, history and other memberships', async ({ page }) => {
    await seeded(page, '#/collections/g-a');
    const tables = ['words', 'cards', 'reviewLogs', 'importRows', 'sources'];
    const before = await Promise.all(tables.map((table) => dump(page, table)));
    await page.getByRole('button', { name: t.collections.deleteList }).click();
    const dialog = page.getByRole('dialog', { name: t.collections.deleteTitle('Zor') });
    await dialog.getByRole('button', { name: t.common.delete }).click();
    await expect(heading(page)).toHaveText(t.collections.title);
    await expect(page.getByRole('link', { name: /^Zor/ })).toHaveCount(0);
    expect(await Promise.all(tables.map((table) => dump(page, table)))).toEqual(before);
    expect((await dump(page, 'groupMembers')).map((m) => m.groupId).sort()).toEqual(['g-b', 'g-pdf']);
  });

  test('a PDF collection can be renamed and deleted, but its words cannot change', async ({ page }) => {
    await seeded(page, '#/collections/g-pdf');
    await expect(main(page)).toContainText(t.collections.kind.pdf);
    await expect(page.getByRole('button', { name: t.collections.deleteCollection })).toBeVisible();
    for (const name of [t.collections.addWords, t.common.select, t.collections.renameList, t.collections.deleteList]) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    const before = await Promise.all(['groupMembers', 'sources', 'importRows'].map((table) => dump(page, table)));

    await page.getByRole('button', { name: t.collections.renameCollection }).click();
    const dialog = page.getByRole('dialog', { name: t.collections.renameCollection });
    const field = dialog.getByLabel(t.collections.collectionName);
    await expect(field).toHaveValue('bolum-1.pdf');
    await expect(field).toHaveAttribute('maxlength', '80');
    await field.fill('   ');
    await save(dialog);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription(t.collections.nameErrors.empty);
    // A list may already use the name: PDF names only have to differ from other PDFs.
    await field.fill('Zor');
    await save(dialog);
    await expect(heading(page)).toHaveText('Zor');
    await page.getByRole('button', { name: t.collections.renameCollection }).click();
    await dialog.getByLabel(t.collections.collectionName).fill('Almanca A1 — Bölüm 7');
    await save(dialog);
    await expect(heading(page)).toHaveText('Almanca A1 — Bölüm 7');
    await page.reload();
    await expect(heading(page)).toHaveText('Almanca A1 — Bölüm 7');
    expect((await dump(page, 'groups')).find((group) => group.id === 'g-pdf')).toMatchObject({ kind: 'pdf', sourceId: 's1', name: 'Almanca A1 — Bölüm 7' });
    expect(await Promise.all(['groupMembers', 'sources', 'importRows'].map((table) => dump(page, table)))).toEqual(before);
  });

  test('a lesson collection is read-only, and can still be deleted', async ({ page }) => {
    await open(page);
    await seed(page, { ...LIBRARY, groups: [...LIBRARY.groups, { id: 'g-lesson', kind: 'lesson', name: 'Lektion 1', order: 3, sourceId: 's1', createdAt: 1 }], groupMembers: [...LIBRARY.groupMembers, { groupId: 'g-lesson', wordId: 'apfel', addedAt: 1, importRowId: 'r1' }] });
    await open(page, '#/collections/g-lesson');
    await expect(main(page)).toContainText(t.collections.kind.lesson);
    for (const name of [t.collections.addWords, t.common.select, t.collections.renameList, t.collections.renameCollection]) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t.collections.deleteCollection })).toBeVisible();
  });

  test('a word manages its lists without touching its source collection', async ({ page }) => {
    await seeded(page, '#/dictionary/apfel');
    await page.getByRole('button', { name: t.dictionary.manageLists }).click();
    const dialog = page.getByRole('dialog', { name: t.collections.listsOf('der Apfel') });
    await dialog.getByRole('checkbox', { name: 'Zor' }).uncheck();
    await dialog.getByLabel(t.collections.newList).fill('Meyveler');
    await dialog.getByRole('button', { name: t.common.add }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Meyveler' })).toBeChecked();
    await save(dialog);
    await expect(dialog).toBeHidden();
    await expect(main(page).getByRole('link', { name: /Meyveler/ })).toBeVisible();
    await expect(main(page).getByRole('link', { name: /^Zor/ })).toHaveCount(0);
    await expect(main(page).getByRole('link', { name: /bolum-1\.pdf/ })).toBeVisible();
  });

  test('a new word can go straight into lists', async ({ page }) => {
    await seeded(page, '#/dictionary/new');
    await fillWord(page, 'die Birne', 'armut');
    await page.getByRole('checkbox', { name: 'Zor' }).check();
    await save(page);
    await expect(heading(page)).toHaveText('die Birne');
    await expect(main(page).getByRole('link', { name: /Zor/ })).toBeVisible();
  });

  test('an empty list leads to adding words', async ({ page }) => {
    await open(page);
    await seed(page, { groups: [{ id: 'empty', kind: 'custom', name: 'Boş', order: 0, sourceId: null, createdAt: 1 }] });
    await open(page, '#/collections/empty');
    await expect(page.getByText(t.collections.emptyGroup)).toBeVisible();
    await expect(page.getByRole('button', { name: t.common.select })).toHaveCount(0);
    await page.getByRole('button', { name: t.collections.addWords }).click();
    await expect(page.getByRole('dialog')).toContainText(t.collections.allAdded);
    await page.getByRole('dialog').getByRole('link', { name: t.collections.createWord }).click();
    await expect(heading(page)).toHaveText(t.wordForm.newTitle);
    await expect(page.getByRole('checkbox', { name: 'Boş' })).toBeChecked();
  });

  test('a new word made from a list starts in that list and comes back to it', async ({ page }) => {
    await seeded(page, '#/collections/g-a');
    await page.getByRole('button', { name: t.collections.addWords }).click();
    await page.getByRole('dialog').getByRole('link', { name: t.collections.createWord }).click();
    await expect(page).toHaveURL(/#\/collections\/g-a\/new$/);
    await expect(heading(page)).toHaveText(t.wordForm.newTitle);
    // Collections stays the current section.
    await expect(page.locator('.nav-link[aria-current="true"]').first()).toContainText(t.nav.collections);
    await expect(page.getByRole('checkbox', { name: 'Zor' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: longList })).not.toBeChecked();

    // Cancelling goes back and changes nothing.
    const words = await dump(page, 'words');
    await fillWord(page, 'die Birne', 'armut');
    await page.getByRole('link', { name: t.common.cancel }).click();
    await expect(heading(page)).toHaveText('Zor');
    expect(await dump(page, 'words')).toEqual(words);

    await open(page, '#/collections/g-a/new');
    await fillWord(page, 'die Birne', 'armut');
    await save(page);
    await expect(heading(page)).toHaveText('Zor');
    await expect(main(page)).toContainText(t.common.words('3'));
    const birne = (await dump(page, 'words')).find((word) => word.lemma === 'Birne')!;
    expect((await dump(page, 'groupMembers')).filter((m) => m.wordId === birne.id).map((m) => m.groupId)).toEqual(['g-a']);
  });

  test('a word that already exists joins the list instead of being made twice', async ({ page }) => {
    await seeded(page, '#/collections/g-b/new');
    const [words, cards, logs] = await Promise.all(['words', 'cards', 'reviewLogs'].map((table) => dump(page, table)));
    await expect(page.getByRole('checkbox', { name: longList })).toBeChecked();
    await fillWord(page, 'der Fuß', 'ayak');
    await save(page);
    await expect(page.getByRole('alert')).toContainText(t.wordForm.exists);
    await page.getByRole('button', { name: t.wordForm.addToLists }).click();
    await expect(heading(page)).toHaveText(longList);
    await expect(main(page).getByRole('link', { name: /Fuß/ })).toBeVisible();
    expect(await Promise.all(['words', 'cards', 'reviewLogs'].map((table) => dump(page, table)))).toEqual([words, cards, logs]);
    expect((await dump(page, 'groupMembers')).filter((m) => m.wordId === 'fuss').map((m) => m.groupId)).toEqual(['g-b']);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`a list's selection fits 320px, much larger text and the desktop, with no detectable problems in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((value) => localStorage.setItem('vosli.theme', value), scheme);
      await seeded(page, '#/collections/g-b');
      for (const [width, size] of [[320, '16px'], [320, '32px'], [1280, '16px']] as const) {
        await page.setViewportSize({ width, height: 700 });
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), size);
        const label = `${width}px ${size}`;
        await expect(heading(page)).toHaveText(longList);
        expect(await overflowing(page), label).toEqual([]);
        await axe(page, `${label} list`);
        await page.getByRole('button', { name: t.common.select }).click();
        await page.getByRole('checkbox').first().check();
        expect(await overflowing(page), label).toEqual([]);
        await axe(page, `${label} selecting`);
        await page.getByRole('button', { name: t.common.cancel }).click();
      }
    });
  }
});

const toReview = async (page: Page, text: string) => {
  await page.getByLabel(t.import.pasteLabel).fill(text);
  await page.getByRole('button', { name: t.import.next }).click();
  await expect(heading(page)).toHaveText(t.import.reviewTitle);
};

const asCsv = (name: string, text: string | Buffer) => ({ name, mimeType: 'text/csv', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const rows = (page: Page) => page.getByTestId('review-row');
const commitButton = (page: Page) => page.getByRole('button', { name: /satırı kaydet/ });

async function commit(page: Page) {
  await commitButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: t.common.save }).click();
  await expect(heading(page)).toHaveText(t.import.doneTitle);
}

test.describe('paste import', () => {
  test('previews, saves on confirmation, and summarizes', { tag: '@smoke' }, async ({ page }) => {
    await open(page, '#/import');
    await toReview(page, 'der Apfel - elma, alma\nessen = yemek yemek\ndas Essen\tyemek\ndie Größe: boy');
    await expect(page.getByRole('radio', { name: t.import.filterAll })).toBeChecked();
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).first()).toContainText(t.import.status.new);
    expect(await dump(page, 'words')).toEqual([]);

    await commitButton(page).click();
    const dialog = page.getByRole('dialog', { name: t.import.confirmTitle('4') });
    await dialog.getByRole('button', { name: t.common.cancel }).click();
    await expect(dialog).toBeHidden();
    expect(await dump(page, 'words')).toEqual([]);

    await commit(page);
    await expect(page.getByTestId('summary-created')).toHaveText('4');
    const words = await dump(page, 'words');
    expect(words.map((word) => word.identityKey).sort()).toEqual(['Apfel|der', 'Essen|das', 'Größe|die', 'essen|']);
    expect(await dump(page, 'sources')).toMatchObject([{ fileName: '' }]);
    expect((await dump(page, 'importRows')).length).toBe(4);

    await page.getByRole('link', { name: t.import.toDictionary }).click();
    await page.getByRole('link', { name: /der Apfel/ }).click();
    await expect(main(page)).toContainText(t.dictionary.pastedSource);
  });

  test('blocks saving until an incomplete row is corrected, inline', async ({ page }) => {
    await open(page, '#/import');
    await toReview(page, 'der Apfel - elma\nessen');
    await expect(page.getByRole('radio', { name: /Kontrol/ })).toBeChecked();
    await expect(rows(page)).toHaveCount(1);
    await expect(commitButton(page)).toBeDisabled();
    await expect(page.getByText(t.import.waiting('1'))).toBeVisible();

    const turkish = rows(page).getByLabel(t.import.turkishField);
    await turkish.pressSequentially('yemek yemek');
    // The row being fixed stays in place and the field keeps focus while the problem goes away.
    await expect(turkish).toBeFocused();
    await expect(turkish).toHaveValue('yemek yemek');
    await expect(rows(page)).toHaveCount(1);
    await expect(commitButton(page)).toBeEnabled();
    await commit(page);
    await expect(page.getByTestId('summary-created')).toHaveText('2');
  });

  test('excluded rows are not saved and appear in the summary', async ({ page }) => {
    await open(page, '#/import');
    await toReview(page, 'der Apfel - elma\nessen\nFuß');
    await page.getByRole('button', { name: t.import.excludeProblems }).click();
    await expect(rows(page)).toHaveCount(3);
    await commit(page);
    await expect(page.getByTestId('summary-created')).toHaveText('1');
    await expect(page.getByTestId('summary-invalid')).toHaveText('2');
    await expect(page.getByTestId('summary-rows')).toHaveText('3');
    expect((await dump(page, 'words')).length).toBe(1);
  });

  test('sorts repeats and matches with stored words', async ({ page }) => {
    await open(page);
    await seed(page);
    await open(page, '#/import');
    await toReview(page, 'der Apfel - elma\ndie Birne - armut\ndie Birne - armut\nder Fuß - ayak, taban');
    await expect(rows(page).nth(0)).toContainText(t.import.status.existing);
    await expect(rows(page).nth(1)).toContainText(t.import.status.new);
    await expect(rows(page).nth(2)).toContainText(t.import.status.repeat);
    await expect(rows(page).nth(3)).toContainText(t.import.status.meaning);
    await expect(rows(page).nth(3)).toContainText('taban');
    const [cards, logs] = [await dump(page, 'cards'), await dump(page, 'reviewLogs')];
    await commit(page);
    await expect(page.getByTestId('summary-created')).toHaveText('1');
    await expect(page.getByTestId('summary-existing')).toHaveText('2');
    await expect(page.getByTestId('summary-repeats')).toHaveText('1');
    await expect(page.getByTestId('summary-linked')).toHaveText('2');
    await expect(page.getByTestId('summary-rows')).toHaveText('4');
    await expect(page.getByTestId('summary-meanings')).toHaveText('1');
    const words = await dump(page, 'words');
    expect(words.filter((word) => word.lemma === 'Birne').length).toBe(1);
    expect((words.find((word) => word.id === 'fuss')?.meanings as { text: string }[]).map((m) => m.text)).toEqual(['ayak', 'taban']);
    expect(await dump(page, 'cards')).toEqual(cards);
    expect(await dump(page, 'reviewLogs')).toEqual(logs);
  });

  test('asks about ambiguous rows and applies the answer', async ({ page }) => {
    await open(page);
    await seed(page);
    await open(page, '#/import');
    await toReview(page, 'die See - deniz\nder See - deniz\nApfel - elma');
    await expect(rows(page)).toHaveCount(3);
    await expect(commitButton(page)).toBeDisabled();
    await expect(rows(page).nth(0)).toContainText(t.import.reasons.article);
    await expect(rows(page).nth(1)).toContainText(t.import.reasons.meaning);
    await expect(rows(page).nth(2)).toContainText(t.import.reasons.article_missing);
    await rows(page).nth(0).getByLabel(t.import.choiceLabel).selectOption({ label: t.import.keepSeparate });
    await rows(page).nth(1).getByLabel(t.import.choiceLabel).selectOption({ value: 'see' });
    await rows(page).nth(2).getByLabel(t.import.choiceLabel).selectOption({ value: 'apfel' });
    await expect(commitButton(page)).toBeEnabled();
    await commit(page);
    const words = await dump(page, 'words');
    expect(words.filter((word) => word.lemma === 'See').map((word) => word.article).sort()).toEqual(['der', 'die']);
    expect((words.find((word) => word.id === 'see')?.meanings as { text: string }[]).map((m) => m.text)).toEqual(['göl', 'deniz']);
    expect(words.filter((word) => word.lemma === 'Apfel').length).toBe(1);
  });

  test('correcting a row re-checks it', async ({ page }) => {
    await open(page);
    await seed(page);
    await open(page, '#/import');
    await toReview(page, 'der Birne - armut');
    await rows(page).getByRole('button', { name: t.import.editRow('der Birne') }).click();
    await rows(page).getByLabel(t.import.articleField).selectOption('die');
    await expect(rows(page)).toContainText('die Birne');
    await rows(page).getByLabel(t.import.germanField).fill('Apfel');
    await rows(page).getByLabel(t.import.articleField).selectOption('der');
    await rows(page).getByLabel(t.import.turkishField).fill('elma');
    await expect(rows(page)).toContainText(t.import.status.existing);
  });

  test('adds an import to a new list, without disturbing source collections', async ({ page }) => {
    await open(page);
    await seed(page);
    await open(page, '#/import');
    await toReview(page, 'der Apfel - elma\ndie Birne - armut');
    await page.getByLabel(t.import.target).selectOption(t.import.targetNew);
    await page.getByLabel(t.import.targetName).fill('Zor');
    await commitButton(page).click();
    await page.getByRole('dialog').getByRole('button', { name: t.common.save }).click();
    await expect(page.getByText(t.collections.nameErrors.taken)).toBeVisible();
    expect((await dump(page, 'words')).length).toBe(5);

    await page.getByLabel(t.import.targetName).fill('Meyveler');
    await commit(page);
    await page.getByRole('link', { name: t.import.toGroup }).click();
    await expect(heading(page)).toHaveText('Meyveler');
    await expect(main(page)).toContainText(t.common.words('2'));
    expect((await dump(page, 'groupMembers')).find((m) => m.groupId === 'g-pdf')).toMatchObject({ importRowId: 'r1' });
  });

  test('leaving the screen keeps the review in progress', async ({ page }) => {
    await open(page, '#/import');
    await toReview(page, 'der Apfel - elma');
    await page.getByRole('navigation', { name: t.mainNav }).getByRole('link', { name: t.nav.dictionary }).click();
    await page.goBack();
    await expect(heading(page)).toHaveText(t.import.reviewTitle);
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe('CSV import', () => {
  test('reads quotes, delimiters and special letters from a file with headers', async ({ page }) => {
    await open(page, '#/import');
    await page.locator('input[type=file]').setInputFiles(asCsv('liste.csv', '﻿Almanca;Artikel;Türkçe;Çoğul\r\nGröße;die;"boy; büyüklük";Größen\r\n"Fuß";der;ayak;Füße\r\n'));
    await expect(heading(page)).toHaveText(t.import.reviewTitle);
    await expect(rows(page)).toHaveCount(2);
    await commit(page);
    const words = await dump(page, 'words');
    expect(words.find((word) => word.lemma === 'Größe')).toMatchObject({ article: 'die', plural: 'Größen', meanings: [{ text: 'boy' }, { text: 'büyüklük' }] });
    expect(await dump(page, 'sources')).toMatchObject([{ fileName: 'liste.csv' }]);
  });

  test('asks for columns when it cannot tell them apart, and lets them be changed later', async ({ page }) => {
    await open(page, '#/import');
    await page.locator('input[type=file]').setInputFiles(asCsv('tablo.csv', 'x,Apfel,elma,y\nx,Birne,armut,y\n'));
    await expect(heading(page)).toHaveText(t.import.mapTitle);
    await page.getByLabel(t.import.column('1')).selectOption('ignore');
    await page.getByLabel(t.import.column('2')).selectOption('ignore');
    await expect(page.getByRole('button', { name: t.import.next })).toBeDisabled();
    await expect(page.getByText(t.import.mapHint)).toBeVisible();
    await page.getByLabel(t.import.column('2')).selectOption('german');
    await page.getByLabel(t.import.column('3')).selectOption('turkish');
    await page.getByRole('button', { name: t.import.next }).click();
    await expect(rows(page).first()).toContainText('Apfel');
    await expect(rows(page).first()).toContainText('elma');
    await page.getByRole('button', { name: t.import.changeColumns }).click();
    await expect(heading(page)).toHaveText(t.import.mapTitle);
    await expect(page.getByLabel(t.import.column('2'))).toHaveValue('german');
  });

  test('reads a Windows-1254 file without damaging Turkish letters', async ({ page }) => {
    await open(page, '#/import');
    await page.locator('input[type=file]').setInputFiles(asCsv('excel.csv', Buffer.from([0x46, 0x75, 0xdf, 0x3b, 0xfd, 0xfe, 0x0a, 0x45, 0x69, 0x73, 0x3b, 0x62, 0x7a])));
    await expect(rows(page).first()).toContainText('Fuß');
    await expect(rows(page).first()).toContainText('ış');
  });

  test('refuses an oversized or empty file with a plain message', async ({ page }) => {
    await open(page, '#/import');
    await page.locator('input[type=file]').setInputFiles(asCsv('kocaman.csv', Buffer.alloc(5 * 1024 * 1024 + 1, 'a')));
    await expect(page.getByText(t.import.fileTooLarge)).toBeVisible();
    await page.locator('input[type=file]').setInputFiles(asCsv('bos.csv', '\n\n'));
    await expect(page.getByText(t.import.nothingFound)).toBeVisible();
    await expect(heading(page)).toHaveText(t.import.title);
  });

  test('asks before discarding corrections, and only then', async ({ page }) => {
    await open(page, '#/import');
    await toReview(page, 'der Apfel - elma\ndie Birne - armut');
    const cancel = page.getByRole('button', { name: t.common.cancel });
    await cancel.click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(heading(page)).toHaveText(t.import.title);

    await toReview(page, 'der Apfel - elma\ndie Birne - armut');
    await rows(page).first().getByRole('button', { name: /düzenle/ }).click();
    const german = rows(page).first().getByLabel(t.import.germanField);
    await german.fill('Äpfel');
    await cancel.click();
    const dialog = page.getByRole('dialog', { name: t.import.discardTitle });
    await expect(dialog).toContainText(t.import.discardBody('1'));

    // Keyboard: focus starts on the safe choice and Escape stays in the review.
    await expect(dialog.getByRole('button', { name: t.import.keepEditing })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(german).toHaveValue('Äpfel');

    // Undoing the change means there is nothing left to lose.
    await german.fill('Apfel');
    await cancel.click();
    await expect(heading(page)).toHaveText(t.import.title);

    await toReview(page, 'der Apfel - elma\ndie Birne - armut');
    await rows(page).first().getByRole('checkbox').uncheck();
    await cancel.click();
    await page.getByRole('dialog').getByRole('button', { name: t.import.discard }).click();
    await expect(heading(page)).toHaveText(t.import.title);
    expect(await dump(page, 'words')).toEqual([]);
  });

  test('changing columns asks first when rows were corrected', async ({ page }) => {
    await open(page, '#/import');
    await page.locator('input[type=file]').setInputFiles(asCsv('liste.csv', 'Almanca,Türkçe\nApfel,elma\nBirne,armut\n'));
    await rows(page).first().getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: t.import.changeColumns }).click();
    const dialog = page.getByRole('dialog', { name: t.import.discardTitle });
    await dialog.getByRole('button', { name: t.import.keepEditing }).click();
    await expect(rows(page).first().getByRole('checkbox')).not.toBeChecked();
    await page.getByRole('button', { name: t.import.changeColumns }).click();
    await dialog.getByRole('button', { name: t.import.discard }).click();
    await expect(heading(page)).toHaveText(t.import.mapTitle);
  });

  test('importing the same file twice creates nothing new', async ({ page }) => {
    await open(page, '#/import');
    const file = asCsv('liste.csv', 'Apfel,elma\nBirne,armut\n');
    await page.locator('input[type=file]').setInputFiles(file);
    await commit(page);
    await page.getByRole('button', { name: t.import.another }).click();
    await page.locator('input[type=file]').setInputFiles(file);
    await commit(page);
    await expect(page.getByTestId('summary-created')).toHaveText('0');
    await expect(page.getByTestId('summary-existing')).toHaveText('2');
    await expect(page.getByTestId('summary-linked')).toHaveText('0');
    expect((await dump(page, 'words')).length).toBe(2);
    expect((await dump(page, 'sources')).length).toBe(1);
    expect((await dump(page, 'importRows')).length).toBe(2);
  });
});

test.describe('backup of collections, sources and warnings', () => {
  test.skip(({ isMobile }) => isMobile, 'Downloads differ on mobile emulation; covered on desktop and by unit tests');

  test('a downloaded backup restores favorites, lists, sources and history through the interface', async ({ page }) => {
    await open(page);
    await seed(page);
    await open(page, '#/import');
    await toReview(page, 'die Birne - armut');
    await page.getByLabel(t.import.target).selectOption({ label: 'Zor' });
    await commit(page);
    await page.goto('./#/settings');
    const tables = ['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows'];
    const sorted = (rows: Record<string, unknown>[]) => rows.map((row) => JSON.stringify(row)).sort();
    const before = (await Promise.all(tables.map((table) => dump(page, table)))).map(sorted);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: t.settings.download }).click()]);
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);

    await seed(page, { words: [makeWord('later', 'Später', null, ['sonra'])] });
    await page.locator('input[type=file]').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.concat(chunks) });
    await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: t.restore.confirm }).click()]);
    await expect(page.getByRole('status').filter({ hasText: t.restore.done })).toBeVisible();

    expect((await Promise.all(tables.map((table) => dump(page, table)))).map(sorted)).toEqual(before);
    await open(page, '#/dictionary/apfel');
    await expect(page.getByRole('button', { name: t.dictionary.favoriteOff })).toBeVisible();
    await expect(main(page)).toContainText('bolum-1.pdf');
  });
});

test.describe('keyboard and focus', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop keyboard only');

  test('Enter saves the form, and Escape closes dialogs and returns focus', async ({ page }) => {
    await seeded(page, '#/dictionary/apfel');
    const opener = page.getByRole('button', { name: t.dictionary.deleteWord });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.goto('./#/dictionary/new');
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('die Birne');
    await page.getByLabel(t.wordForm.turkish, { exact: true }).fill('armut');
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText('die Birne');
  });

  test('typing der Apfel selects the article when leaving the field', async ({ page }) => {
    await open(page, '#/dictionary/new');
    const german = page.getByLabel(t.wordForm.german, { exact: true });
    await german.fill('der Apfel');
    await german.blur();
    await expect(page.getByRole('radio', { name: 'der', exact: true })).toBeChecked();
    await expect(german).toHaveValue('Apfel');
  });

  test('checkboxes in the word picker work from the keyboard', async ({ page }) => {
    await seeded(page, '#/collections/g-b');
    await page.getByRole('button', { name: t.collections.addWords }).click();
    const box = page.getByRole('dialog').getByRole('checkbox').first();
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
  });
});

test.describe('layout and accessibility', () => {
  const LONG = {
    ...LIBRARY,
    words: [...LIBRARY.words, ...Array.from({ length: 30 }, (_, i) => makeWord(`z${i}`, `Zzz${i}`, null, ['çeviri']))],
  };
  const LONG_PASTE = `die ${longLemma} - ${longMeaning}\nessen\ndie See - deniz\nder Apfel - elma, alma`;

  const walk = async (page: Page, check: (label: string) => Promise<void>) => {
    for (const route of ['#/dictionary', '#/dictionary/new', '#/dictionary/long', '#/dictionary/long/edit', '#/dictionary/apfel', '#/collections', '#/collections/g-b', '#/collections/g-a', '#/import']) {
      await open(page, route);
      await check(route);
    }
    await open(page, '#/dictionary/apfel');
    await page.getByRole('button', { name: t.dictionary.manageLists }).click();
    await check('lists dialog');
    await open(page, '#/dictionary/apfel');
    await page.getByRole('button', { name: t.dictionary.deleteWord }).click();
    await check('delete dialog');
    await open(page, '#/collections/g-b');
    await page.getByRole('button', { name: t.collections.addWords }).click();
    await check('word picker');
    await open(page, '#/dictionary/new');
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('die See');
    await page.getByLabel(t.wordForm.turkish, { exact: true }).fill('deniz');
    await save(page);
    await check('word conflict');
    await open(page, '#/import');
    await toReview(page, LONG_PASTE);
    await check('review problems');
    await page.getByRole('radio', { name: t.import.filterAll }).check();
    await page.getByLabel(t.import.target).selectOption(t.import.targetNew);
    await check('review all');
    await page.getByRole('button', { name: t.common.cancel }).first().click();
    await page.locator('input[type=file]').setInputFiles(asCsv('kocaman uzun dosya adı 2026 kopya son hali.csv', 'a,b,c,d\n1,2,3,4\n'));
    await expect(heading(page)).toHaveText(t.import.mapTitle);
    await check('column mapping');
    await page.getByRole('button', { name: t.import.back }).click();
    await toReview(page, 'die Birne - armut');
    await commit(page);
    await check('import summary');
  };

  for (const [width, height, rootPx] of [[320, 568, 16], [320, 568, 24], [390, 844, 32], [768, 1024, 16], [1280, 800, 16]] as const) {
    test(`everything fits at ${width}x${height}, ${rootPx}px text, with long data`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'Sizes are set directly');
      test.slow();
      await page.setViewportSize({ width, height });
      if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
      await open(page);
      await seed(page, LONG);
      await walk(page, async (label) => {
        expect(await overflowing(page), label).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, label).toBeLessThanOrEqual(0);
      });
    });
  }

  test('new controls meet the 44px touch target on a phone', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Size is set directly');
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page);
    await seed(page, LONG);
    const tall = (selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height).filter((height) => height > 0));
    const SELECTOR = 'main .btn, main .icon-btn, main .row-press, main .check-row, main .field, main .link-btn, main .review-check, main .segmented span, dialog .btn, dialog .check-row, dialog .field';
    for (const route of ['#/dictionary', '#/dictionary/new', '#/dictionary/apfel', '#/collections/g-a', '#/import']) {
      await open(page, route);
      for (const height of await tall(SELECTOR)) expect(height, route).toBeGreaterThanOrEqual(44);
    }
    await open(page, '#/import');
    await toReview(page, 'essen\nder See - deniz');
    for (const height of await tall(SELECTOR)) expect(height, 'review').toBeGreaterThanOrEqual(44);
    await open(page, '#/collections/g-b');
    await page.getByRole('button', { name: t.collections.addWords }).click();
    for (const height of await tall(SELECTOR)) expect(height, 'picker').toBeGreaterThanOrEqual(44);
  });

  test('headings and controls hold their shape on a phone', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Size is set directly');
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await seed(page, LONG);

    // The header buttons must not squeeze a title into breaking mid-word.
    await open(page, '#/collections');
    const line = await heading(page).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await heading(page).boundingBox())!.height).toBeLessThanOrEqual(line + 1);

    // The article control is one row of choices, not a block stretched to fill its column.
    await open(page, '#/dictionary/new');
    const articleBox = (await page.locator('.segmented-full').boundingBox())!;
    expect(articleBox.height).toBeLessThan(60);
    expect(articleBox.width).toBeGreaterThan(300);

    // A conflict panel lands fully above the tab bar.
    await page.getByLabel(t.wordForm.german, { exact: true }).fill('die See');
    await page.getByLabel(t.wordForm.turkish, { exact: true }).fill('deniz');
    await save(page);
    await expect(page.getByRole('alert')).toBeFocused();
    await settled(page);
    const panel = (await page.getByRole('alert').boundingBox())!;
    const nav = (await page.getByRole('navigation', { name: t.mainNav }).boundingBox())!;
    expect(panel.y + panel.height).toBeLessThanOrEqual(nav.y);

    // The picker's action stays on one line.
    await open(page, '#/collections/g-b');
    await page.getByRole('button', { name: t.collections.addWords }).click();
    const action = page.getByRole('button', { name: t.collections.addSelected('0') });
    expect((await action.boundingBox())!.height).toBeLessThanOrEqual(48);
  });

  test('inputs never trigger the iOS zoom', async ({ page }) => {
    await open(page);
    await seed(page, LONG);
    for (const route of ['#/dictionary/new', '#/import']) {
      await open(page, route);
      for (const size of await page.locator('main input:not([type=checkbox]):not([type=radio]):not([type=file]), main textarea, main select').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))) expect(size).toBeGreaterThanOrEqual(16);
    }
    await open(page, '#/import');
    await toReview(page, 'essen\nder See - deniz');
    for (const size of await page.locator('main input:not([type=checkbox]):not([type=radio]), main select').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))) expect(size).toBeGreaterThanOrEqual(16);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`every new state has no detectable accessibility problems in ${scheme}`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'One viewport is enough for structure and contrast');
      test.slow();
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await seed(page);
      await walk(page, (label) => axe(page, label));
    });
  }
});
