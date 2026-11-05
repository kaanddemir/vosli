import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { t } from '../src/i18n/strings';
import { buildPdf, tablePage, type VocabRow } from '../tests/support/pdfBuilder';

async function open(page: Page, hash = '#/import') {
  await page.goto(`./${hash}`);
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const rows = (page: Page) => page.getByTestId('review-row');
const commitButton = (page: Page) => page.locator('.review-commit .btn-primary');
const openSettings = (page: Page) => page.getByRole('button', { name: t.import.pdfSettings }).click();
const openEditor = (row: Locator) => row.getByRole('button', { name: /düzenle/ }).click();
const warning = (row: Locator) => row.getByRole('button', { name: /uyarı/ });
const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
const choose = (page: Page, file: ReturnType<typeof pdf>) => page.locator('input[type=file]').setInputFiles(file);
const reviewed = (page: Page) => expect(heading(page)).toHaveText(t.import.reviewTitle, { timeout: 30_000 });

async function commit(page: Page) {
  await commitButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: t.common.save }).click();
  await expect(heading(page)).toHaveText(t.import.doneTitle);
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

const FRUITS: readonly VocabRow[] = [['Apfel', 'der', 'elma'], ['Birne', 'die', 'armut'], ['essen', '-', 'yemek yemek'], ['Straße', 'die', 'cadde, yol'], ['Bär', 'der', 'ayı']];
const LESSON = buildPdf([tablePage(FRUITS.slice(0, 3), { heading: 'Lektion 1' }), tablePage(FRUITS.slice(3), { heading: 'Lektion 1' })]);
const LONG_WORD = 'Donaudampfschifffahrtsgesellschaftskapitän';
const LONG_NAME = 'Konu+sonu+kelime+listesi+bölüm+üç+son+hali+düzeltilmiş+kopya+2026+Telaffuz+Die+Aussprache.pdf';
const MESSY = buildPdf([
  [
    ...tablePage([['Apfel', 'der', 'elma'], ['Birne', 'die', ''], [LONG_WORD, 'der', 'Tuna buharlı gemi işletmeciliği'], ['Haus', '', 'ev'], ['essen', '-', 'yemek yemek'], ['Apfel', 'der', 'elma']], { heading: 'Lektion 2' }),
    { text: 'şirketinin kaptanı', x: 400, y: 643 },
  ],
  [{ text: 'Sadece bir cümle.', x: 50, y: 700 }],
]);

test('a PDF goes from selection to the dictionary, with its source and collections', { tag: '@smoke' }, async ({ page }) => {
  await open(page);
  await choose(page, pdf('Ders+1.pdf', LESSON));
  await reviewed(page);
  await expect(page.locator('.eyebrow')).toHaveText('Ders+1.pdf');
  await expect(page.getByTestId('review-tally')).toHaveText(`5 yeni · ${t.import.pdfFacts('2', '5')}`);
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).first()).toContainText('der Apfel');
  await expect(rows(page).first()).toContainText('elma');
  // Where a row came from waits in its details.
  await expect(rows(page).first()).not.toContainText(t.import.page('1'));
  await expect(rows(page).nth(3)).toContainText('Straße');
  await expect(rows(page).nth(4)).toContainText('Bär');
  await openEditor(rows(page).nth(4));
  await expect(rows(page).nth(4).getByTestId('row-origin')).toHaveText(t.import.rowOrigin('2', '2'));
  await openSettings(page);
  await expect(page.getByTestId('pdf-details')).toContainText('Ders+1.pdf');
  await expect(page.getByLabel(t.import.pdfCollection)).toHaveValue('Ders 1');
  await expect(page.getByLabel(t.import.lessonName)).toHaveValue('Lektion 1');
  expect(await dump(page, 'words')).toEqual([]);

  await commit(page);
  await expect(page.getByTestId('summary-created')).toHaveText('5');
  await expect(page.getByTestId('summary-groups')).toHaveText('Ders 1 · Lektion 1');
  const groups = await dump(page, 'groups');
  expect(groups.map((group) => [group.kind, group.name])).toEqual(expect.arrayContaining([['pdf', 'Ders 1'], ['lesson', 'Lektion 1']]));
  expect(await dump(page, 'sources')).toMatchObject([{ fileName: 'Ders+1.pdf' }]);
  expect((await dump(page, 'importRows')).map((row) => [row.page, row.rowIndex])).toEqual(expect.arrayContaining([[1, 1], [2, 2]]));

  await page.getByRole('link', { name: t.import.toPdfGroup }).click();
  await expect(heading(page)).toHaveText('Ders 1');
  await page.getByRole('link', { name: /Bär/ }).click();
  await expect(page.getByRole('main')).toContainText('Ders+1.pdf');
  await expect(page.getByRole('main')).toContainText(t.import.page('2'));
  await expect(page.getByRole('main')).toContainText('Lektion 1');
});

test('counts and notices wait behind the info icon, which says when one needs reading', async ({ page, browserName }) => {
  await open(page);
  await choose(page, pdf('karisik.pdf', MESSY));
  await reviewed(page);
  const info = page.getByRole('button', { name: t.import.infoLabel });
  const tally = page.getByTestId('review-tally');
  await expect(tally).toBeHidden();
  await expect(info).toHaveClass(/icon-btn-on/);
  await info.click();
  await expect(tally).toBeVisible();
  await expect(tally).toContainText('2 sayfa');
  await expect(page.getByTestId('pdf-notes')).toContainText(t.import.notices.no_table('2'));
  await expect(page.getByTestId('pdf-notes')).toBeVisible();
  await expect(page.getByTestId('pdf-notes')).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(tally).toBeHidden();
  // Safari does not focus a clicked button, so there is nothing to return to. The keyboard route is tested below.
  if (browserName !== 'webkit') await expect(info).toBeFocused();

  await page.getByRole('button', { name: t.common.cancel }).click();
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await expect(page.getByRole('button', { name: t.import.infoLabel })).not.toHaveClass(/icon-btn-on/);
});

test('the warning icon sits left of edit, and the filter fills its row', async ({ page }) => {
  await open(page);
  await choose(page, pdf('karisik.pdf', MESSY));
  await reviewed(page);
  await page.getByRole('radio', { name: /Uyarılar/ }).check();
  const row = rows(page).filter({ hasText: 'Haus' });
  const [icon, edit] = [await warning(row).boundingBox(), await row.getByRole('button', { name: /düzenle/ }).boundingBox()];
  expect(icon!.x + icon!.width).toBeLessThanOrEqual(edit!.x + 1);
  expect(Math.abs(icon!.y - edit!.y)).toBeLessThan(2);
  const [filter, list] = [await page.locator('.review-toolbar .segmented').boundingBox(), await page.locator('main ul.list').first().boundingBox()];
  expect(Math.abs(filter!.width - list!.width)).toBeLessThan(2);
});

test('blocking rows come first and must be fixed, warnings are optional, repairs stay quiet', async ({ page }) => {
  await open(page);
  await choose(page, pdf('karisik.pdf', MESSY));
  await reviewed(page);
  await expect(page.getByTestId('pdf-notes')).toContainText(t.import.notices.no_table('2'));

  // Birne has no meaning, which blocks saving and says so in the row.
  await expect(page.getByRole('radio', { name: /Kontrol/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Kontrol/ })).toHaveAccessibleName('Kontrol (1)');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(t.import.errors.turkish_missing);
  await expect(page.getByText(t.import.waiting('1'))).toBeVisible();
  await expect(commitButton(page)).toBeDisabled();
  await rows(page).getByLabel(t.import.turkishField).fill('armut');
  await expect(commitButton(page)).toBeEnabled();

  // Haus has an empty article cell, which does not block saving.
  await page.getByRole('radio', { name: /Uyarılar/ }).check();
  await expect(rows(page)).toHaveCount(1);
  const haus = rows(page).filter({ hasText: 'Haus' });
  await expect(haus.getByText(t.import.warnings.article_missing)).toBeHidden();
  await warning(haus).click();
  await expect(haus.getByText(t.import.warnings.article_missing)).toBeVisible();
  await page.keyboard.press('Escape');

  // A repaired row looks like any other; the repair is in its details.
  await page.getByRole('radio', { name: t.import.filterAll }).check();
  await expect(rows(page)).toHaveCount(6);
  const long = rows(page).filter({ hasText: LONG_WORD });
  await expect(long).toContainText('Tuna buharlı gemi işletmeciliği şirketinin kaptanı');
  await expect(long).not.toContainText(t.import.corrections.wrapped);
  await expect(warning(long)).toHaveCount(0);
  await openEditor(long);
  await expect(long.getByTestId('row-origin')).toContainText(t.import.corrections.wrapped);
  await expect(rows(page).last()).toContainText(t.import.status.repeat);

  await commit(page);
  await expect(page.getByTestId('summary-created')).toHaveText('5');
  await expect(page.getByTestId('summary-repeats')).toHaveText('1');
  await expect(page.getByTestId('summary-rows')).toHaveText('6');
  expect((await dump(page, 'words')).map((word) => word.identityKey)).toEqual(expect.arrayContaining(['Haus|', 'Birne|die']));
  expect((await dump(page, 'importRows')).find((row) => row.german === 'Birne')).toMatchObject({ flags: expect.arrayContaining(['edited']) });
});

test.describe('warnings', () => {
  // Kranken/haus is split with no hyphen and has an empty article: two warnings on one row.
  const WARNED = buildPdf([[...tablePage([['Apfel', 'der', 'elma'], ['Haus', '', 'ev'], ['Kranken', '', 'hastane'], ['essen', '-', 'yemek yemek'], ['apfelsine', 'die', 'portakal'], ['Birne', 'die', 'armut']]), { text: 'haus', x: 125, y: 638 }]]);
  const start = async (page: Page) => {
    await open(page);
    await choose(page, pdf('uyari.pdf', WARNED));
    await reviewed(page);
    await expect(page.getByRole('radio', { name: /Uyarılar/ })).toBeChecked();
  };
  const filterName = (n: number) => `${t.import.filterWarnings} (${n})`;

  test('open with those rows, and never block saving', async ({ page }) => {
    await start(page);
    await expect(page.getByRole('radio', { name: filterName(3) })).toBeChecked();
    await expect(rows(page)).toHaveCount(3);
    await expect(commitButton(page)).toBeEnabled();
    await commitButton(page).click();
    await expect(page.getByRole('dialog')).toContainText(t.import.confirmWarnings);
    await page.getByRole('dialog').getByRole('button', { name: t.common.save }).click();
    await expect(heading(page)).toHaveText(t.import.doneTitle);
    expect((await dump(page, 'words')).length).toBe(6);
  });

  test('explain all their reasons, on request, by keyboard', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Physical keyboards only');
    await start(page);
    const row = rows(page).filter({ hasText: 'Kranken' });
    const button = warning(row);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toHaveAccessibleName(t.import.warningLabel('Kranken haus', '2'));
    await expect(row.getByText(t.import.warnings.article_missing)).toBeHidden();

    await button.focus();
    await page.keyboard.press('Enter');
    await expect(row.getByText(t.import.warnings.article_missing)).toBeVisible();
    await expect(row.getByText(t.import.warnings.wrapped_word)).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByText(t.import.warnings.wrapped_word)).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(page.getByText(t.import.warnings.wrapped_word)).toBeVisible();
  });

  test('open by tap, close by tapping elsewhere, and stay beside their icon on screen', async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.scrollTo(0, 200));
    const row = rows(page).filter({ hasText: 'apfelsine' });
    await warning(row).click();
    const panel = page.getByText(t.import.warnings.article_lowercase);
    await expect(panel).toBeInViewport({ ratio: 1 });
    const [icon, box] = [await warning(row).boundingBox(), await panel.boundingBox()];
    expect(Math.abs(box!.y - icon!.y)).toBeLessThan(200);
    const size = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    await heading(page).click();
    await expect(panel).toBeHidden();
  });

  test('update as rows change, and only go when the cause does', async ({ page }) => {
    await start(page);
    const kranken = rows(page).filter({ hasText: 'Kranken' });
    await openEditor(kranken);

    // Editing the meaning changes nothing about the warnings.
    await kranken.getByLabel(t.import.turkishField).fill('hasta evi');
    await expect(page.getByRole('radio', { name: filterName(3) })).toBeVisible();
    await expect(warning(kranken)).toHaveAccessibleName(/2 uyarı/);

    // Fixing one cause leaves the other.
    await kranken.getByLabel(t.import.germanField).fill('Krankenhaus');
    const whole = rows(page).filter({ hasText: 'Krankenhaus' });
    await expect(warning(whole)).toHaveAccessibleName(/1 uyarı/);
    await whole.getByLabel(t.import.articleField).selectOption('das');
    await expect(warning(whole)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: filterName(2) })).toBeVisible();

    // Accepting a warning and excluding a row both finish with it, and focus stays in the list.
    const haus = rows(page).filter({ hasText: 'Haus' }).first();
    await warning(haus).click();
    await page.getByRole('button', { name: t.import.warningAccept }).click();
    await expect(page.getByRole('radio', { name: filterName(1) })).toBeVisible();
    await expect(page.locator('body')).not.toBeFocused();
    await rows(page).filter({ hasText: 'apfelsine' }).getByRole('checkbox').click();
    await expect(page.getByRole('radio', { name: filterName(0) })).toBeVisible();

    // The row kept in view by the edit leaves with the filter, and the empty state speaks.
    await page.getByRole('radio', { name: t.import.filterAll }).check();
    await page.getByRole('radio', { name: /Uyarılar/ }).check();
    await expect(page.getByText(t.import.noWarnings)).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test('a file without warnings has no warnings filter', async ({ page }) => {
    await open(page);
    await choose(page, pdf('ders.pdf', LESSON));
    await reviewed(page);
    await expect(page.getByRole('radio', { name: /Uyarılar/ })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: t.import.filterAll })).toBeChecked();
  });
});

test('long compound words stay whole, with no drawn hyphens', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Size is set directly');
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  await choose(page, pdf('uzun.pdf', MESSY));
  await reviewed(page);
  await page.getByRole('button', { name: t.import.excludeProblems }).click();
  await page.getByRole('radio', { name: t.import.filterAll }).check();
  const title = rows(page).filter({ hasText: LONG_WORD }).locator('.row-title');
  await expect(title).toContainText(LONG_WORD);
  expect(await title.evaluate((el) => getComputedStyle(el).hyphens)).not.toBe('auto');
  // The controls keep their place when the word wraps.
  const edit = await rows(page).filter({ hasText: LONG_WORD }).getByRole('button', { name: /düzenle/ }).boundingBox();
  const box = await rows(page).filter({ hasText: LONG_WORD }).getByRole('checkbox').boundingBox();
  expect(Math.abs(edit!.y + edit!.height / 2 - (box!.y + box!.height / 2))).toBeLessThan(6);
  await commit(page);
  expect((await dump(page, 'words')).map((word) => word.lemma)).toContain(LONG_WORD);
});

test('the list starts high on a phone, with settings one tap away', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Size is set directly');
  test.skip(!existsSync(`${samples}/bolum-2.pdf`), 'The course PDFs are not in the repository');
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await choose(page, pdf('bolum-2-kopya.pdf', readFileSync(`${samples}/bolum-2.pdf`)));
  await reviewed(page);
  await expect(page.getByTestId('review-tally')).toHaveText('149 yeni · 5 sayfa · 149 satır');
  // It started at 680px before.
  const first = await rows(page).first().boundingBox();
  expect(first!.y).toBeLessThan(320);
  await expect(page.getByTestId('pdf-details')).toBeHidden();
  await openSettings(page);
  await expect(page.getByTestId('pdf-details')).toContainText(t.import.notices.repaired('159'));
  await expect(page.getByLabel(t.import.lessonName)).toBeVisible();
});

test('an emptied collection name opens the settings to say so', async ({ page }) => {
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await openSettings(page);
  await page.getByLabel(t.import.pdfCollection).fill('');
  await openSettings(page);
  await expect(page.getByLabel(t.import.pdfCollection)).toBeHidden();
  await commitButton(page).click();
  await expect(page.getByText(t.import.pdfCollectionEmpty)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('asks before discarding corrections to a PDF, and not otherwise', async ({ page }) => {
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await page.getByRole('button', { name: t.common.cancel }).click();
  await expect(heading(page)).toHaveText(t.import.title);

  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await rows(page).first().getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: t.common.cancel }).click();
  const dialog = page.getByRole('dialog', { name: t.import.discardTitle });
  await dialog.getByRole('button', { name: t.import.keepEditing }).click();
  await expect(rows(page).first().getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: t.common.cancel }).click();
  await dialog.getByRole('button', { name: t.import.discard }).click();
  await expect(heading(page)).toHaveText(t.import.title);
  expect(await dump(page, 'sources')).toEqual([]);
});

test('leaving the screen keeps a PDF review, with its corrections and names', async ({ page }) => {
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await openSettings(page);
  await page.getByLabel(t.import.lessonName).fill('Benim dersim');
  await rows(page).first().getByRole('checkbox').uncheck();
  await page.getByRole('link', { name: t.nav.collections }).first().click();
  await page.goto('./#/import');
  await reviewed(page);
  await expect(page.getByLabel(t.import.lessonName)).toHaveValue('Benim dersim');
  await expect(rows(page).first().getByRole('checkbox')).not.toBeChecked();
});

test.describe('files that cannot be imported', () => {
  const cases: [string, Uint8Array, string][] = [
    ['parola.pdf', buildPdf([tablePage(FRUITS)], { encrypted: true }), t.import.pdfErrors.password],
    ['bozuk.pdf', new TextEncoder().encode('Bu bir PDF değil'), t.import.pdfErrors.corrupt],
    ['tarama.pdf', buildPdf([[], []]), t.import.pdfErrors.no_text],
    ['yazi.pdf', buildPdf([[{ text: 'Sadece bir cümle.', x: 50, y: 700 }]]), t.import.pdfErrors.no_table],
  ];
  for (const [name, bytes, message] of cases) {
    test(`${name} gets a plain message and writes nothing`, async ({ page }) => {
      await open(page);
      await choose(page, pdf(name, bytes));
      await expect(page.getByRole('alert')).toHaveText(message, { timeout: 30_000 });
      await expect(heading(page)).toHaveText(t.import.title);
      expect(await dump(page, 'sources')).toEqual([]);
      // The screen still works afterwards.
      await choose(page, pdf('ders.pdf', LESSON));
      await reviewed(page);
    });
  }

  test('a file over the limit is refused before reading', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
      const huge = new File([], 'dev.pdf', { type: 'application/pdf' });
      Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 + 1 });
      Object.defineProperty(input, 'files', { value: [huge], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.getByRole('alert')).toHaveText(t.import.pdfErrors.too_large);
  });
});

const holdReader = (page: Page) =>
  page.route('**/*pdf.worker*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

test.describe('while a PDF is being read', () => {
  // A service worker would answer before the route that holds the reader back.
  test.use({ serviceWorkers: 'block' });

  test('progress is shown page by page, for assistive technology too', async ({ page }) => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid=pdf-progress]')?.textContent;
        if (text && seen.at(-1) !== text) seen.push(text);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await open(page);
    await holdReader(page);
    await choose(page, pdf('uzun.pdf', buildPdf(Array.from({ length: 5 }, () => tablePage(FRUITS)))));
    await expect(heading(page)).toHaveText(t.import.reading);
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByRole('status')).toHaveText(t.import.preparing);
    await reviewed(page);
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
    expect(seen[0]).toBe(t.import.preparing);
    expect(seen.at(-1)).toBe(t.import.pageOf('5', '5'));
  });

  test('cancelling leaves nothing behind, and the next file reads normally', async ({ page }) => {
    await open(page);
    await holdReader(page);
    await choose(page, pdf('ders.pdf', LESSON));
    await expect(heading(page)).toHaveText(t.import.reading);
    await page.getByRole('button', { name: t.common.cancel }).click();
    await expect(heading(page)).toHaveText(t.import.title);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await dump(page, 'sources')).toEqual([]);
    expect(await dump(page, 'words')).toEqual([]);
    await choose(page, pdf('ders.pdf', LESSON));
    await reviewed(page);
  });

  test('leaving the screen cancels too', async ({ page }) => {
    await open(page);
    await holdReader(page);
    await choose(page, pdf('ders.pdf', LESSON));
    await expect(heading(page)).toHaveText(t.import.reading);
    await page.getByRole('link', { name: t.nav.collections }).first().click();
    await expect(heading(page)).toHaveText(t.collections.title);
    await page.evaluate(() => {
      location.hash = '#/import';
    });
    await expect(heading(page)).toHaveText(t.import.title);
    await page.waitForTimeout(2000);
    await expect(heading(page)).toHaveText(t.import.title);
    await choose(page, pdf('ders.pdf', LESSON));
    await reviewed(page);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no detectable accessibility problems in ${scheme}`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'One viewport is enough for structure and contrast');
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await holdReader(page);
      await choose(page, pdf('ders.pdf', LESSON));
      await expect(heading(page)).toHaveText(t.import.reading);
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target} ${n.any[0]?.message ?? ''}`).join(', ')}`)).toEqual([]);
    });
  }
});

test('importing again, overlapping and changed files', async ({ page }) => {
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await commit(page);
  const members = (await dump(page, 'groupMembers')).length;

  // The same content, under another name.
  await page.getByRole('button', { name: t.import.another }).click();
  await choose(page, pdf('baska-ad.pdf', LESSON));
  await reviewed(page);
  await expect(page.getByTestId('pdf-notes')).toContainText(t.import.notices.reused);
  await expect(page.getByLabel(t.import.pdfCollection)).toHaveCount(0);
  await commit(page);
  await expect(page.getByTestId('summary-created')).toHaveText('0');
  await expect(page.getByTestId('summary-existing')).toHaveText('5');
  await expect(page.getByTestId('summary-linked')).toHaveText('0');
  expect((await dump(page, 'sources')).length).toBe(1);
  expect((await dump(page, 'groupMembers')).length).toBe(members);

  // A changed file under the same name is another source.
  await page.getByRole('button', { name: t.import.another }).click();
  await choose(page, pdf('ders.pdf', buildPdf([tablePage([['Apfel', 'der', 'elma'], ['Haus', 'das', 'ev']], { heading: 'Lektion 2' })])));
  await reviewed(page);
  await expect(page.getByTestId('pdf-notes')).toContainText(t.import.notices.sameName);
  await commit(page);
  await expect(page.getByTestId('summary-created')).toHaveText('1');
  await expect(page.getByTestId('summary-existing')).toHaveText('1');
  await expect(page.getByTestId('summary-linked')).toHaveText('1');
  expect((await dump(page, 'sources')).length).toBe(2);
  expect((await dump(page, 'words')).filter((word) => word.lemma === 'Apfel').length).toBe(1);
  expect((await dump(page, 'groups')).map((group) => group.name)).toEqual(expect.arrayContaining(['ders', 'ders (2)', 'Lektion 1', 'Lektion 2']));
});

test('a backup keeps PDF collections and recognizes the file after restoring', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Downloads differ on mobile emulation; covered on desktop and by unit tests');
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await commit(page);
  await page.goto('./#/settings');
  const tables = ['groups', 'groupMembers', 'sources', 'importRows'];
  const snapshot = async () => (await Promise.all(tables.map((table) => dump(page, table)))).map((table) => table.map((row) => JSON.stringify(row)).sort());
  const before = await snapshot();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: t.settings.download }).click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  await page.locator('input[type=file]').setInputFiles({ name: 'yedek.json', mimeType: 'application/json', buffer: Buffer.concat(chunks) });
  await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: t.restore.confirm }).click()]);
  await expect(page.getByRole('status').filter({ hasText: t.restore.done })).toBeVisible();
  expect(await snapshot()).toEqual(before);
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await expect(page.getByTestId('pdf-notes')).toContainText(t.import.notices.reused);
  expect((await dump(page, 'groups')).map((group) => group.kind)).toEqual(expect.arrayContaining(['pdf', 'lesson']));
});

test('a PDF collection deleted on its own page comes back on import, without new words', async ({ page }) => {
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await commit(page);
  const words = (await dump(page, 'words')).map((word) => word.id).sort();
  const sources = await dump(page, 'sources');
  const importRows = await dump(page, 'importRows');

  await page.getByRole('link', { name: t.import.toPdfGroup }).click();
  await expect(heading(page)).toHaveText('ders');
  await page.getByRole('button', { name: t.collections.deleteCollection }).click();
  const dialog = page.getByRole('dialog', { name: t.collections.deleteTitle('ders') });
  await expect(dialog).toContainText(t.collections.deleteOnlyDetail);
  await dialog.getByRole('button', { name: t.common.delete }).click();
  await expect(heading(page)).toHaveText(t.collections.title);
  await expect(page.getByRole('link', { name: /^ders/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Lektion 1/ })).toBeVisible();
  expect(await dump(page, 'sources')).toEqual(sources);
  expect(await dump(page, 'importRows')).toEqual(importRows);

  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await commit(page);
  expect((await dump(page, 'words')).map((word) => word.id).sort()).toEqual(words);
  expect(await dump(page, 'sources')).toEqual(sources);
  expect(await dump(page, 'importRows')).toEqual(importRows);
  const groups = await dump(page, 'groups');
  const remade = groups.find((group) => group.kind === 'pdf')!;
  expect(remade.name).toBe('ders');
  expect((await dump(page, 'groupMembers')).filter((member) => member.groupId === remade.id).map((member) => member.wordId).sort()).toEqual(words);
});

test('importing again says only what is true of the words left', async ({ page }) => {
  const deleteFromDictionary = async (all: boolean) => {
    await page.goto('./#/dictionary');
    await page.getByRole('main').getByRole('button', { name: t.common.select, exact: true }).click();
    if (all) await page.getByRole('button', { name: t.common.selectAll }).click();
    else await page.getByRole('checkbox', { name: /Apfel/ }).check();
    await page.getByRole('main').getByRole('button', { name: t.common.delete, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: t.collections.deleteForeverConfirm }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  };
  const again = async () => {
    await open(page);
    await choose(page, pdf('ders.pdf', LESSON));
    await reviewed(page);
  };
  const info = page.getByRole('button', { name: t.import.infoLabel });

  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await commit(page);

  await deleteFromDictionary(false);
  await again();
  await info.click();
  await expect(page.getByTestId('pdf-notes')).toContainText(t.import.notices.reusedPartly('1'));
  await expect(page.getByTestId('pdf-notes')).not.toContainText(t.import.notices.reused);
  await page.keyboard.press('Escape');
  await commit(page);
  await expect(page.getByTestId('summary-created')).toHaveText('1');

  await again();
  await info.click();
  await expect(page.getByTestId('pdf-notes')).toContainText(t.import.notices.reused);
  await page.keyboard.press('Escape');

  await deleteFromDictionary(true);
  await again();
  await expect(page.getByTestId('pdf-notes')).toHaveCount(0);
  await expect(page.getByTestId('review-tally')).toHaveText(`5 yeni · ${t.import.pdfFacts('2', '5')}`);
  await commit(page);
  await expect(page.getByTestId('summary-created')).toHaveText('5');
  expect(await dump(page, 'cards')).toEqual([]);
  expect(await dump(page, 'sources')).toHaveLength(1);
});

test('works offline once the app has been opened', async ({ page, context, isMobile, browserName }) => {
  test.skip(isMobile, 'The same service worker as on desktop');
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot run service workers offline here; covered on Chromium');
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await open(page);
  await choose(page, pdf('ders.pdf', LESSON));
  await reviewed(page);
  await expect(rows(page)).toHaveCount(5);
  await context.setOffline(false);
});

const samples = process.env.PDF_SAMPLES ?? 'tests/fixtures/local';
test.describe('the real course PDFs', () => {
  test.skip(!existsSync(`${samples}/bolum-2.pdf`), 'The course PDFs are not in the repository');
  test.skip(({ isMobile }) => isMobile, 'Parsing is the same; layout is covered separately');

  test('import in the browser with the hand-checked counts', async ({ page }) => {
    test.slow();
    await open(page);
    const totals = { rows: 0, created: 0 };
    for (const [name, count, created] of [['konu.pdf', 45, 45], ['bolum-1.pdf', 81, 80], ['bolum-2.pdf', 149, 115]] as const) {
      await choose(page, pdf(name, readFileSync(`${samples}/${name}`)));
      await reviewed(page);
      await expect(page.getByTestId('review-tally')).toContainText(`${count} satır`);
      await expect(page.getByRole('radio', { name: t.import.filterAll })).toBeChecked();
      await commit(page);
      await expect(page.getByTestId('summary-rows')).toHaveText(String(count));
      await expect(page.getByTestId('summary-created')).toHaveText(String(created));
      totals.rows += count;
      totals.created += created;
      await page.getByRole('button', { name: t.import.another }).click();
    }
    expect(totals).toEqual({ rows: 275, created: 240 });
    const words = await dump(page, 'words');
    expect(words.length).toBe(240);
    for (const word of words) expect(JSON.stringify(word)).not.toMatch(/[\u0000-\u001f]/);
    expect(words.find((word) => word.lemma === 'Liebe')).toMatchObject({ article: 'die', meanings: [{ text: 'aşk' }] });
    expect(words.find((word) => word.lemma === 'Geldautomat')).toMatchObject({ article: 'das' });
    expect((await dump(page, 'groups')).filter((group) => group.kind === 'lesson').map((group) => group.name).sort()).toEqual(['ALFABE - DAS ALPHABET', 'SELAMLAŞMA VE VEDALAŞMAK. - DIE GRUßFORMELN', 'TELAFFUZ - DIE AUSSPRACHE']);
  });
});

test.describe('layout and accessibility', () => {
  const walk = async (page: Page, check: (label: string) => Promise<void>) => {
    await open(page);
    await check('input');
    await choose(page, pdf('parola.pdf', buildPdf([tablePage(FRUITS)], { encrypted: true })));
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
    await check('error');
    await choose(page, pdf(LONG_NAME, MESSY));
    await reviewed(page);
    await check('review problems');
    await page.getByRole('radio', { name: /Uyarılar/ }).check();
    await warning(rows(page).filter({ hasText: 'Haus' })).click();
    await check('warning popover');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: t.import.infoLabel }).click();
    await check('info popover');
    await page.keyboard.press('Escape');
    await page.getByRole('radio', { name: t.import.filterAll }).check();
    await rows(page).filter({ hasText: LONG_WORD }).getByRole('button', { name: /düzenle/ }).click();
    await openSettings(page);
    await check('review all, settings open');
    await openSettings(page);
    await rows(page).filter({ hasText: 'Birne' }).getByLabel(t.import.turkishField).fill('armut');
    await page.getByRole('button', { name: t.import.excludeProblems }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: t.common.cancel }).click();
    await page.getByRole('dialog').waitFor();
    await check('discard dialog');
    await page.getByRole('dialog').getByRole('button', { name: t.import.keepEditing }).click();
    await commitButton(page).click();
    await page.getByRole('dialog').waitFor();
    await check('confirm dialog');
    await page.getByRole('dialog').getByRole('button', { name: t.common.save }).click();
    await expect(heading(page)).toHaveText(t.import.doneTitle);
    await check('summary');
  };

  for (const [width, height, rootPx] of [[320, 568, 16], [320, 568, 24], [390, 844, 32], [1280, 800, 16]] as const) {
    test(`fits at ${width}x${height}, ${rootPx}px text, with long names`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'Sizes are set directly');
      test.slow();
      await page.setViewportSize({ width, height });
      if (rootPx !== 16) await page.addInitScript((px) => addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${px}px`)), rootPx);
      await walk(page, async (label) => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, label).toBeLessThanOrEqual(0);
        const spilling = await page.evaluate(() => {
          const limit = document.documentElement.clientWidth;
          return [...document.querySelectorAll('main *, dialog *')].filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.right > limit + 1;
          }).map((el) => el.className || el.tagName).slice(0, 5);
        });
        expect(spilling, label).toEqual([]);
      });
    });
  }

  test('the new controls meet the touch target and do not zoom on focus', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Size is set directly');
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page);
    await choose(page, pdf('ders.pdf', LESSON));
    await reviewed(page);
    for (const height of await page.locator('main .btn:visible, main .icon-btn:visible, main .field:visible, main .review-check:visible').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);
    await openSettings(page);
    for (const size of await page.locator('main input:not([type=checkbox]):not([type=radio]), main select').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))) expect(size).toBeGreaterThanOrEqual(16);
  });

  test('the whole review works from the keyboard', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile, 'Physical keyboards only');
    await open(page);
    await page.getByRole('button', { name: t.import.chooseFile }).focus();
    await choose(page, pdf('ders.pdf', LESSON));
    await reviewed(page);
    const box = rows(page).first().getByRole('checkbox');
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await commitButton(page).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: t.common.cancel })).toBeFocused();
    // Safari's Tab skips buttons unless the user turns that setting on.
    if (browserName === 'webkit') await dialog.getByRole('button', { name: t.common.save }).focus();
    else await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: t.common.save })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText(t.import.doneTitle);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no detectable accessibility problems in ${scheme}`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'One viewport is enough for structure and contrast');
      test.slow();
      await page.emulateMedia({ colorScheme: scheme });
      await walk(page, async (label) => {
        // A dialog starts animating a frame after it opens, and its colors are measured at rest.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${label}: ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      });
    });
  }
});
