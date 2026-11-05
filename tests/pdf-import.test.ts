import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { dismissalKey } from '../src/core/issues';
import { needsAttention, reviewRows, rowOutcome, SEPARATE, tallyRows, type ImportDraft } from '../src/core/review';
import { createBackup, exportBackupText, parseBackup, restoreBackup } from '../src/data/backup';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { deleteGroups, deleteGroupsWithWords, previewGroupDeletion, GroupNameError, ProtectedGroupError, renameCustomGroup } from '../src/data/groups';
import { commitImport, type SourceCollections } from '../src/data/importCommit';
import { getGroupWithWords, listGroupsOfWord, listOriginsOfWord, listGroupSummaries, listActiveWords } from '../src/data/repository';
import { readDismissals } from '../src/data/dismissals';
import { addWord, deleteWord, deleteWords, knownEntryOf, setFavorite, updateWord } from '../src/data/words';
import { collectionNameOf, preparePdfImport, type PdfImport } from '../src/pdf/importPdf';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, PdfCancelled, PdfReadError, readPdfText, type PdfLibrary } from '../src/pdf/readPdf';
import { makeCard, T0, uniqueDbName } from './support/fixtures';
import { buildPdf, tablePage, type VocabRow } from './support/pdfBuilder';

const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfLibrary;

const open: AppDatabase[] = [];
async function fresh(): Promise<AppDatabase> {
  const db = await openDatabase({ name: uniqueDbName() });
  open.push(db);
  return db;
}
afterEach(() => open.splice(0).forEach((db) => db.close()));

const FRUITS: readonly VocabRow[] = [['Apfel', 'der', 'elma'], ['Birne', 'die', 'armut'], ['essen', '-', 'yemek yemek'], ['Straße', 'die', 'cadde, yol'], ['Bär', 'der', 'ayı'], ['Çiçek', '', 'şğıİ']];
const LESSON_ONE = buildPdf([tablePage(FRUITS, { heading: 'Lektion 1' })]);
const prepare = (db: AppDatabase, bytes: Uint8Array<ArrayBuffer>, name = 'ders.pdf') => preparePdfImport(db, lib, name, bytes.slice());
const save = (db: AppDatabase, prepared: PdfImport, collections: Partial<SourceCollections> = {}, drafts: ImportDraft[] = prepared.drafts) =>
  commitImport(db, { source: prepared.source, drafts, target: { kind: 'none' }, collections: { ...prepared.collections, ...collections } }, T0);
const problem = (promise: Promise<unknown>) => promise.then(() => 'no error', (error: PdfReadError) => error.problem);

describe('reading real PDF files', () => {
  it('reads several pages through PDF.js, keeping German and Turkish letters', async () => {
    const pages = await readPdfText(lib, buildPdf([tablePage(FRUITS), tablePage([['Haus', 'das', 'ev']])]));
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
    expect(pages[0]!.items.map((item) => item.text)).toEqual(expect.arrayContaining(['Straße', 'Bär', 'şğıİ']));
  });

  it('repairs the unmapped Turkish i in a real font, end to end', async () => {
    const db = await fresh();
    const bytes = buildPdf([tablePage([['Liebe', 'die', 'kadın sevgisi'], ['Zeit', 'die', 'açık zaman'], ['viel', '-', 'çok ılık']], { header: true })], { brokenI: '\u001e' });
    const raw = (await readPdfText(lib, bytes.slice())).flatMap((page) => page.items.map((item) => item.text));
    expect(raw).toContain('L\u001eebe');
    const prepared = await prepare(db, bytes);
    expect(prepared.drafts.map((draft) => draft.german)).toEqual(['Liebe', 'Zeit', 'viel']);
    expect(prepared.info.notices).toContainEqual(expect.objectContaining({ kind: 'repaired' }));
  });

  it('reads a landscape page stored as a rotated one', async () => {
    const db = await fresh();
    // Stored turned 90° and shown upright, as scanners and some exporters do.
    const shownUpright = tablePage(FRUITS, { top: 500 }).map((run) => ({ ...run, x: 595 - run.y, y: run.x, angle: 90 }));
    const prepared = await prepare(db, buildPdf([shownUpright], { rotate: 90 }));
    expect(prepared.drafts.map((draft) => draft.german)).toEqual(FRUITS.map(([german]) => german));
  });

  it('ignores a diagonal watermark', async () => {
    const db = await fresh();
    const prepared = await prepare(db, buildPdf([[...tablePage(FRUITS), { text: 'ÖRNEK', x: 200, y: 400, size: 60, angle: 45 }]]));
    expect(prepared.drafts).toHaveLength(FRUITS.length);
  });

  it('refuses a password protected file', async () => {
    expect(await problem(readPdfText(lib, buildPdf([tablePage(FRUITS)], { encrypted: true })))).toBe('password');
  });

  it('refuses corrupted and foreign bytes', async () => {
    expect(await problem(readPdfText(lib, new TextEncoder().encode('Bu bir PDF değil')))).toBe('corrupt');
    expect(await problem(readPdfText(lib, new Uint8Array(0)))).toBe('corrupt');
    const truncated = LESSON_ONE.slice(0, 40);
    expect(await problem(readPdfText(lib, truncated))).toBe('corrupt');
  });

  it('refuses a file over the size limit before opening it', async () => {
    expect(await problem(readPdfText(lib, new Uint8Array(MAX_PDF_BYTES + 1)))).toBe('too_large');
  });

  it('refuses too many pages', async () => {
    const blank = Array.from({ length: MAX_PDF_PAGES + 1 }, () => []);
    expect(await problem(readPdfText(lib, buildPdf(blank)))).toBe('too_many_pages');
  });

  it('tells an empty or scanned file from one without a table', async () => {
    const db = await fresh();
    expect(await problem(prepare(db, buildPdf([[], []])))).toBe('no_text');
    expect(await problem(prepare(db, buildPdf([[{ text: 'Sadece bir cümle.', x: 50, y: 700 }]])))).toBe('no_table');
    expect(await db.sources.count()).toBe(0);
  });

  it('reports progress page by page', async () => {
    const seen: string[] = [];
    await readPdfText(lib, buildPdf([tablePage(FRUITS), tablePage(FRUITS), tablePage(FRUITS)]), { onProgress: (done, total) => seen.push(`${done}/${total}`) });
    expect(seen).toEqual(['0/3', '1/3', '2/3', '3/3']);
  });

  it('stops when cancelled, before and during reading', async () => {
    const control = new AbortController();
    control.abort();
    await expect(readPdfText(lib, LESSON_ONE.slice(), { signal: control.signal })).rejects.toBeInstanceOf(PdfCancelled);

    const midway = new AbortController();
    const reading = readPdfText(lib, buildPdf(Array.from({ length: 40 }, () => tablePage(FRUITS))), {
      signal: midway.signal,
      onProgress: (done) => {
        if (done === 2) midway.abort();
      },
    });
    await expect(reading).rejects.toBeInstanceOf(PdfCancelled);
  });

  it('can read again after a failure and after a cancel', async () => {
    await problem(readPdfText(lib, new Uint8Array(4)));
    expect((await readPdfText(lib, LESSON_ONE.slice())).length).toBe(1);
  });
});

describe('names', () => {
  it('turns a download name into readable words', () => {
    expect(collectionNameOf('Konu+sonu+kelime+listesi.pdf')).toBe('Konu sonu kelime listesi');
    expect(collectionNameOf('bolum-1.PDF')).toBe('bolum-1');
    expect(collectionNameOf('.pdf')).toBe('.pdf');
    expect(collectionNameOf(`${'a'.repeat(200)}.pdf`)).toHaveLength(80);
  });
});

describe('importing a PDF', () => {
  it('writes nothing until the import is committed', async () => {
    const db = await fresh();
    await prepare(db, LESSON_ONE);
    expect([await db.words.count(), await db.sources.count(), await db.groups.count(), await db.importRows.count()]).toEqual([0, 0, 0, 0]);
  });

  it('keeps page and row, registers the source by content, and creates its collections', async () => {
    const db = await fresh();
    const prepared = await prepare(db, buildPdf([tablePage(FRUITS.slice(0, 3), { heading: 'Lektion 1' }), tablePage(FRUITS.slice(3), { heading: 'Lektion 1' })]), 'Ders+1.pdf');
    expect(prepared.drafts.map((draft) => [draft.page, draft.rowIndex])).toEqual([[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]);
    expect(prepared.collections).toEqual({ pdfName: 'Ders 1', lessons: { 'Lektion 1': 'Lektion 1' } });

    const summary = await save(db, prepared);
    expect(summary).toMatchObject({ rows: 6, created: 6, existing: 0, repeats: 0, sourceReused: false });
    expect(summary.pdfGroup).toMatchObject({ kind: 'pdf', name: 'Ders 1' });
    expect(summary.lessonGroups.map((group) => [group.kind, group.name])).toEqual([['lesson', 'Lektion 1']]);
    const [source] = await db.sources.toArray();
    expect(source).toMatchObject({ fileName: 'Ders+1.pdf', fileHash: prepared.source.fileHash });
    expect(summary.pdfGroup!.sourceId).toBe(source!.id);
    const baer = (await listActiveWords(db)).find((word) => word.lemma === 'Bär')!;
    expect(await listOriginsOfWord(db, baer.id)).toEqual([{ source: source, pages: [2] }]);
    expect((await listGroupsOfWord(db, baer.id)).map((group) => group.kind)).toEqual(['pdf', 'lesson']);
  });

  it('makes no lesson collection when no name is given, and no name is invented', async () => {
    const db = await fresh();
    const prepared = await prepare(db, buildPdf([tablePage(FRUITS)]));
    expect(prepared.info.sections).toEqual(['']);
    expect(prepared.collections.lessons).toEqual({ '': '' });
    const summary = await save(db, prepared);
    expect(summary.lessonGroups).toEqual([]);
    expect(await db.groups.where('kind').equals('lesson').count()).toBe(0);
  });

  it('uses a lesson name typed by the user', async () => {
    const db = await fresh();
    const prepared = await prepare(db, buildPdf([tablePage(FRUITS)]));
    const summary = await save(db, prepared, { lessons: { '': 'Meyveler dersi' } });
    expect(summary.lessonGroups[0]).toMatchObject({ kind: 'lesson', name: 'Meyveler dersi' });
    expect((await getGroupWithWords(db, summary.lessonGroups[0]!.id))?.words).toHaveLength(FRUITS.length);
  });

  it('gives each section its own lesson collection', async () => {
    const db = await fresh();
    const prepared = await prepare(db, buildPdf([tablePage(FRUITS.slice(0, 3), { heading: 'Lektion 1' }), tablePage(FRUITS.slice(3), { heading: 'Lektion 2' })]));
    const summary = await save(db, prepared);
    expect(summary.lessonGroups.map((group) => group.name)).toEqual(['Lektion 1', 'Lektion 2']);
    expect((await getGroupWithWords(db, summary.lessonGroups[1]!.id))?.words.map((word) => word.lemma)).toEqual(['Bär', 'Çiçek', 'Straße']);
  });

  it('refuses an empty collection name and writes nothing', async () => {
    const db = await fresh();
    await expect(save(db, await prepare(db, LESSON_ONE), { pdfName: '  ' })).rejects.toBeInstanceOf(GroupNameError);
    expect([await db.words.count(), await db.sources.count(), await db.groups.count()]).toEqual([0, 0, 0]);
  });

  it('deleting source collections keeps every record, and importing again brings them back without duplicates', async () => {
    const db = await fresh();
    const prepared = await prepare(db, LESSON_ONE);
    const first = await save(db, prepared);
    const [word] = await listActiveWords(db);
    await db.cards.add(makeCard(word!.id));
    const snapshot = async () => ({ words: await db.words.toArray(), cards: await db.cards.toArray(), logs: await db.reviewLogs.toArray(), sources: await db.sources.toArray(), rows: await db.importRows.toArray() });
    const before = await snapshot();
    const members = (await db.groupMembers.toArray()).length;
    const names = (await db.groups.toArray()).map((group) => [group.kind, group.name]);

    await deleteGroups(db, [first.pdfGroup!.id, first.lessonGroups[0]!.id]);
    expect(await db.groups.count()).toBe(0);
    expect(await db.groupMembers.count()).toBe(0);
    expect(await snapshot()).toEqual(before);

    // The PDF collection always returns. A lesson repeats the earlier choice, and "deleted" reads as "none", so it returns when named.
    const again = await save(db, await prepare(db, LESSON_ONE));
    expect(again).toMatchObject({ created: 0, sourceReused: true });
    expect((await db.groups.toArray()).map((group) => [group.kind, group.name])).toEqual([['pdf', 'ders']]);
    expect(await snapshot()).toEqual(before);

    await save(db, await prepare(db, LESSON_ONE), { lessons: { 'Lektion 1': 'Lektion 1' } });
    expect((await db.groups.toArray()).map((group) => [group.kind, group.name]).sort()).toEqual([...names].sort());
    expect(await db.groupMembers.count()).toBe(members);
    expect(await snapshot()).toEqual(before);
  });

  it('words deleted with their collection return only if the learner imports the file and saves them', async () => {
    const db = await fresh();
    const first = await save(db, await prepare(db, LESSON_ONE));
    const ids = [first.pdfGroup!.id, first.lessonGroups[0]!.id];
    await deleteGroupsWithWords(db, ids, (await previewGroupDeletion(db, ids)).ownWordIds);
    expect(await db.words.count()).toBe(0);
    expect(await db.sources.count()).toBe(1);

    const again = await prepare(db, LESSON_ONE);
    expect(await db.words.count()).toBe(0);
    expect(again.drafts.every((draft) => draft.linked === null)).toBe(true);
    expect(tallyRows(reviewRows(again.drafts, [])).create).toBe(FRUITS.length);

    const saved = await save(db, again);
    expect(saved).toMatchObject({ created: FRUITS.length, sourceReused: true });
    expect(await db.cards.count()).toBe(0);
    expect(await db.sources.count()).toBe(1);
  });

  describe('a file seen before, by what is left of its words', () => {
    const wordIds = async (db: AppDatabase) => (await listActiveWords(db)).map((word) => word.id);

    it('all still there: the duplicate import stays as it was', async () => {
      const db = await fresh();
      await save(db, await prepare(db, LESSON_ONE));
      const again = await prepare(db, LESSON_ONE);
      expect(again.info).toMatchObject({ reused: true, remaining: 'all', missingWords: 0, namesCollection: false });
      expect(await save(db, again)).toMatchObject({ created: 0, existing: FRUITS.length, sourceReused: true });
    });

    it('some deleted: the count is of those, they come back without their history, and the rest keep theirs', async () => {
      const db = await fresh();
      await save(db, await prepare(db, LESSON_ONE));
      const [gone, kept] = await listActiveWords(db);
      await db.cards.bulkAdd([makeCard(gone!.id), makeCard(kept!.id)]);
      await deleteWords(db, [gone!.id]);

      const again = await prepare(db, LESSON_ONE);
      expect(again.info).toMatchObject({ reused: true, remaining: 'some', missingWords: 1, namesCollection: false });
      expect(again.collections.lessons).toEqual({ 'Lektion 1': 'Lektion 1' });

      expect(await save(db, again)).toMatchObject({ created: 1, sourceReused: true });
      expect(await db.sources.count()).toBe(1);
      const cards = await db.cards.toArray();
      expect(cards.map((card) => card.wordId)).toEqual([kept!.id]);
      expect(await db.reviewLogs.where('wordId').equals(gone!.id).count()).toBe(0);
    });

    it('all deleted: a normal import, though the source is still known and no history returns', async () => {
      const db = await fresh();
      await save(db, await prepare(db, LESSON_ONE));
      const ids = await wordIds(db);
      await db.cards.add(makeCard(ids[0]!));
      await deleteWords(db, ids);

      const again = await prepare(db, LESSON_ONE);
      expect(again.info).toMatchObject({ reused: true, remaining: 'none', missingWords: FRUITS.length, namesCollection: false });
      expect(await save(db, again)).toMatchObject({ created: FRUITS.length, sourceReused: true });
      expect(await db.sources.count()).toBe(1);
      expect(await db.cards.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);
    });

    it('all deleted with the collections: the collection can be named again, and a deleted lesson stays deleted', async () => {
      const db = await fresh();
      const first = await save(db, await prepare(db, LESSON_ONE));
      const ids = [first.pdfGroup!.id, first.lessonGroups[0]!.id];
      await deleteGroupsWithWords(db, ids, (await previewGroupDeletion(db, ids)).ownWordIds);

      const again = await prepare(db, LESSON_ONE);
      expect(again.info).toMatchObject({ remaining: 'none', namesCollection: true });
      expect(again.collections.lessons).toEqual({ 'Lektion 1': '' });
      const saved = await save(db, again, { pdfName: 'Yeni ad' });
      expect(saved.pdfGroup?.name).toBe('Yeni ad');
      expect(saved.lessonGroups).toEqual([]);
    });

    it('a word added by hand since then does not make a deleted file look imported', async () => {
      const db = await fresh();
      await save(db, await prepare(db, LESSON_ONE));
      await deleteWords(db, await wordIds(db));
      await addWord(db, { lemma: 'Apfel', article: 'der', meanings: ['elma'], plural: null }, null, [], T0);
      const again = await prepare(db, LESSON_ONE);
      expect(again.info).toMatchObject({ remaining: 'none', missingWords: FRUITS.length - 1 });
    });

    it('a first import is not treated as seen before', async () => {
      const db = await fresh();
      expect((await prepare(db, LESSON_ONE)).info).toMatchObject({ reused: false, remaining: 'none', missingWords: 0, namesCollection: true });
    });
  });

  it('source collections stay protected, and custom lists stay independent', async () => {
    const db = await fresh();
    const prepared = await prepare(db, LESSON_ONE);
    const summary = await commitImport(db, { source: prepared.source, drafts: prepared.drafts, target: { kind: 'new_group', name: 'Benim listem' }, collections: prepared.collections }, T0);
    expect(summary.group).toMatchObject({ kind: 'custom', sourceId: null });
    await expect(renameCustomGroup(db, summary.pdfGroup!.id, 'x')).rejects.toBeInstanceOf(ProtectedGroupError);
    await expect(renameCustomGroup(db, summary.lessonGroups[0]!.id, 'x')).rejects.toBeInstanceOf(ProtectedGroupError);
  });
});

describe('importing a PDF again', () => {
  it('changes nothing the second time', async () => {
    const db = await fresh();
    await save(db, await prepare(db, LESSON_ONE));
    const before = await createBackup(db, T0);
    const prepared = await prepare(db, LESSON_ONE);
    expect(prepared.info.reused).toBe(true);
    const summary = await save(db, prepared);
    expect(summary).toMatchObject({ created: 0, existing: 6, linked: 0, repeats: 0, sourceReused: true });
    expect(await createBackup(db, T0)).toEqual(before);
  });

  it('recognizes the content under another name', async () => {
    const db = await fresh();
    await save(db, await prepare(db, LESSON_ONE, 'ilk.pdf'));
    const prepared = await prepare(db, LESSON_ONE, 'baska-ad.pdf');
    expect(prepared.info.reused).toBe(true);
    await save(db, prepared);
    expect(await db.sources.count()).toBe(1);
    expect(await db.groups.where('kind').equals('pdf').count()).toBe(1);
  });

  it('treats changed content under the same name as a new source, without new words for old rows', async () => {
    const db = await fresh();
    await save(db, await prepare(db, LESSON_ONE));
    const changed = buildPdf([tablePage([...FRUITS, ['Haus', 'das', 'ev']], { heading: 'Lektion 1' })]);
    const prepared = await prepare(db, changed);
    expect(prepared.info).toMatchObject({ reused: false, sameNameDifferent: true });
    const summary = await save(db, prepared);
    expect(summary).toMatchObject({ created: 1, existing: 6, linked: 6, sourceReused: false });
    expect(summary.pdfGroup!.name).toBe('ders (2)');
    expect(await db.sources.count()).toBe(2);
    expect(await db.groups.where('kind').equals('pdf').count()).toBe(2);
    // Both files carry the same lesson heading, so they share one lesson collection.
    expect(await db.groups.where('kind').equals('lesson').count()).toBe(1);
    expect(await db.words.count()).toBe(7);
  });

  it('remembers the choice of no lesson', async () => {
    const db = await fresh();
    await save(db, await prepare(db, LESSON_ONE), { lessons: { 'Lektion 1': '' } });
    const again = await prepare(db, LESSON_ONE);
    expect(again.collections.lessons).toEqual({ 'Lektion 1': '' });
  });

  it('repeats the lesson name given the first time', async () => {
    const db = await fresh();
    const bytes = buildPdf([tablePage(FRUITS)]);
    await save(db, await prepare(db, bytes), { lessons: { '': 'Benim dersim' } });
    expect((await prepare(db, bytes)).collections.lessons).toEqual({ '': 'Benim dersim' });
  });

  it('completes rows excluded the first time, without doubling the others', async () => {
    const db = await fresh();
    const first = await prepare(db, LESSON_ONE);
    await save(db, first, {}, first.drafts.map((draft, index) => (index === 0 ? { ...draft, excluded: true } : draft)));
    expect(await db.words.count()).toBe(5);
    expect(await db.importRows.count()).toBe(6);
    const summary = await save(db, await prepare(db, LESSON_ONE));
    expect(summary).toMatchObject({ created: 1, existing: 5 });
    expect(await db.importRows.count()).toBe(6);
    expect(await db.importRows.filter((row) => row.decision === 'skipped').count()).toBe(0);
    expect(await db.groupMembers.count()).toBe(12);
  });

  it('never overwrites a correction made in the dictionary: it asks', async () => {
    const db = await fresh();
    const first = await prepare(db, buildPdf([tablePage([['Geldautomat', 'das', 'ATM']])]));
    await save(db, first);
    const word = (await listActiveWords(db))[0]!;
    await db.words.put({ ...word, article: 'der', identityKey: 'Geldautomat|der' });
    const again = await prepare(db, buildPdf([tablePage([['Geldautomat', 'das', 'ATM']])]));
    const rows = reviewRows(again.drafts, (await listActiveWords(db)).map(knownEntryOf));
    expect(rows[0]!.status).toMatchObject({ kind: 'ambiguous', reason: 'article' });
    expect((await db.words.get(word.id))?.article).toBe('der');
  });
});

describe('words shared between PDFs', () => {
  const SECOND: readonly VocabRow[] = [['Apfel', 'der', 'elma'], ['Haus', 'das', 'ev'], ['Birne', 'die', 'armut']];

  it('share one record, which belongs to both collections and both sources', async () => {
    const db = await fresh();
    const one = await save(db, await prepare(db, LESSON_ONE, 'bir.pdf'));
    const two = await save(db, await prepare(db, buildPdf([tablePage(SECOND, { heading: 'Lektion 2' })]), 'iki.pdf'));
    expect(two).toMatchObject({ rows: 3, created: 1, existing: 2, linked: 2 });
    const apfel = (await listActiveWords(db)).find((word) => word.lemma === 'Apfel')!;
    expect(await db.words.filter((word) => word.lemma === 'Apfel').count()).toBe(1);
    expect((await listGroupsOfWord(db, apfel.id)).map((group) => group.id).sort()).toEqual([one.pdfGroup!.id, one.lessonGroups[0]!.id, two.pdfGroup!.id, two.lessonGroups[0]!.id].sort());
    expect((await listOriginsOfWord(db, apfel.id)).map((origin) => origin.source.fileName).sort()).toEqual(['bir.pdf', 'iki.pdf']);
    const counts = new Map((await listGroupSummaries(db)).map(({ group, wordCount }) => [group.name, wordCount]));
    expect(counts.get('bir')).toBe(6);
    expect(counts.get('iki')).toBe(3);
  });

  it('keep essen and das Essen apart', async () => {
    const db = await fresh();
    await save(db, await prepare(db, LESSON_ONE));
    const summary = await save(db, await prepare(db, buildPdf([tablePage([['Essen', 'das', 'yemek']])]), 'iki.pdf'));
    expect(summary).toMatchObject({ created: 1, existing: 0 });
    expect((await db.words.toArray()).map((word) => word.identityKey)).toEqual(expect.arrayContaining(['essen|', 'Essen|das']));
  });

  it('asks about a different article or meaning', async () => {
    const db = await fresh();
    await save(db, await prepare(db, buildPdf([tablePage([['See', 'der', 'göl'], ['Bank', 'die', 'banka']])])));
    const next = await prepare(db, buildPdf([tablePage([['See', 'die', 'deniz'], ['Bank', 'die', 'sıra']])]), 'iki.pdf');
    const rows = reviewRows(next.drafts, (await listActiveWords(db)).map(knownEntryOf));
    expect(rows.map((row) => row.status)).toMatchObject([{ kind: 'ambiguous', reason: 'article' }, { kind: 'ambiguous', reason: 'meaning' }]);
    await expect(save(db, next)).rejects.toThrow();
    expect(await db.sources.count()).toBe(1);
    const summary = await save(db, next, {}, next.drafts.map((draft) => ({ ...draft, choice: SEPARATE })));
    expect(summary.created).toBe(2);
  });

  it('folds a repeat inside one PDF, keeping both places', async () => {
    const db = await fresh();
    const prepared = await prepare(db, buildPdf([tablePage([['Apfel', 'der', 'elma'], ['Haus', 'das', 'ev']]), tablePage([['Apfel', 'der', 'elma']])]));
    const rows = reviewRows(prepared.drafts, []);
    expect(rows.map(rowOutcome)).toEqual(['create', 'create', 'repeat']);
    const summary = await save(db, prepared);
    expect(summary).toMatchObject({ rows: 3, created: 2, repeats: 1 });
    const apfel = (await listActiveWords(db)).find((word) => word.lemma === 'Apfel')!;
    expect((await listOriginsOfWord(db, apfel.id))[0]!.pages).toEqual([1, 2]);
    expect(await db.groupMembers.where('wordId').equals(apfel.id).count()).toBe(1);
  });
});

describe('protecting what is already there', () => {
  it('keeps favorites, cards and history when a PDF links to a known word', async () => {
    const db = await fresh();
    const outcome = await addWord(db, { lemma: 'Apfel', article: 'der', meanings: ['elma'], plural: null }, null, [], T0);
    if (outcome.kind !== 'saved') throw new Error('expected a save');
    const id = outcome.word.id;
    await setFavorite(db, id, true, T0);
    await db.cards.add(makeCard(id));
    await db.reviewLogs.add({ mode: 'practice', wordId: id, track: 'de_tr', at: T0, typed: 'elma', result: 'correct', hintsUsed: 0 });
    const [card, logs, word] = [await db.cards.toArray(), await db.reviewLogs.toArray(), await db.words.get(id)];

    await save(db, await prepare(db, LESSON_ONE));
    await save(db, await prepare(db, LESSON_ONE));

    expect(await db.cards.toArray()).toEqual(card);
    expect(await db.reviewLogs.toArray()).toEqual(logs);
    expect(await db.words.get(id)).toEqual(word);
  });

  it('importing the same file again after a delete makes a fresh word, and leaves the others alone', async () => {
    const db = await fresh();
    await save(db, await prepare(db, LESSON_ONE));
    const words = await listActiveWords(db);
    const apfel = words.find((word) => word.lemma === 'Apfel')!;
    await db.cards.add(makeCard(apfel.id));
    await deleteWord(db, apfel.id);
    const [sources, groups] = [await db.sources.count(), await db.groups.count()];
    const summary = await save(db, await prepare(db, LESSON_ONE));
    expect(summary.created).toBe(1);
    const again = (await listActiveWords(db)).filter((word) => word.lemma === 'Apfel');
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(apfel.id);
    expect(await db.cards.where('wordId').equals(apfel.id).count()).toBe(0);
    expect(await db.sources.count()).toBe(sources);
    expect(await db.groups.count()).toBe(groups);
    expect((await listActiveWords(db)).map((word) => word.id).filter((id) => id !== again[0]!.id).sort()).toEqual(words.map((word) => word.id).filter((id) => id !== apfel.id).sort());
  });

  it('rolls everything back when a write fails partway', async () => {
    const db = await fresh();
    await save(db, await prepare(db, buildPdf([tablePage([['Apfel', 'der', 'elma']])]), 'ilk.pdf'));
    const before = await createBackup(db, T0);
    let calls = 0;
    const fail = () => {
      if (++calls === 4) throw new Error('disk full');
    };
    db.groupMembers.hook('creating', fail);
    const prepared = await prepare(db, LESSON_ONE);
    await expect(save(db, prepared)).rejects.toThrow('disk full');
    db.groupMembers.hook('creating').unsubscribe(fail);
    expect(await createBackup(db, T0)).toEqual(before);
  });

  it('survives a backup round trip, and still recognizes the file afterwards', async () => {
    const db = await fresh();
    const summary = await save(db, await prepare(db, LESSON_ONE));
    const parsed = parseBackup(await exportBackupText(db, T0));
    if (!parsed.ok) throw new Error('parse failed');
    const other = await fresh();
    await restoreBackup(other, parsed.backup);
    const [a, b] = [await createBackup(db, T0), await createBackup(other, T0)];
    for (const table of ['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows'] as const) expect(b.tables[table]).toEqual(a.tables[table]);
    const opened = await getGroupWithWords(other, summary.pdfGroup!.id);
    expect(opened?.group.kind).toBe('pdf');
    expect(opened?.words).toHaveLength(FRUITS.length);
    const again = await prepare(other, LESSON_ONE);
    expect(again.info.reused).toBe(true);
    expect(await save(other, again)).toMatchObject({ created: 0, linked: 0 });
  });
});

const samplesDir = process.env.PDF_SAMPLES ?? 'tests/fixtures/local';
const NAMES = ['konu.pdf', 'bolum-1.pdf', 'bolum-2.pdf'];
const samples = NAMES.every((name) => existsSync(`${samplesDir}/${name}`));

describe.skipIf(!samples)('the course PDFs through the whole import', () => {
  const load = (name: string) => new Uint8Array(readFileSync(`${samplesDir}/${name}`));

  it('gives 275 rows, 240 words and 35 repeats, with nothing left to answer', async () => {
    const db = await fresh();
    const all = (await Promise.all(NAMES.map(async (name) => (await prepare(db, load(name), name)).drafts))).flat();
    const tally = tallyRows(reviewRows(all, []));
    expect(all).toHaveLength(275);
    expect(tally).toMatchObject({ create: 240, repeat: 35, pending: 0 });
  });

  it('saves file by file with a summary that adds up, then changes nothing on a second pass', async () => {
    const db = await fresh();
    const totals = { rows: 0, created: 0, existing: 0, repeats: 0 };
    for (const name of NAMES) {
      const summary = await save(db, await prepare(db, load(name), name));
      expect(summary.created + summary.existing + summary.repeats).toBe(summary.rows);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += summary[key];
    }
    expect(totals.rows).toBe(275);
    expect(totals.created).toBe(240);
    expect(totals.existing + totals.repeats).toBe(35);
    expect(await db.words.count()).toBe(240);
    expect(await db.sources.count()).toBe(3);
    expect((await db.groups.toArray()).map((group) => group.kind).sort()).toEqual(['lesson', 'lesson', 'lesson', 'pdf', 'pdf', 'pdf']);

    const before = await createBackup(db, T0);
    for (const name of NAMES) expect(await save(db, await prepare(db, load(name), name))).toMatchObject({ created: 0, linked: 0, sourceReused: true });
    expect(await createBackup(db, T0)).toEqual(before);
  });
});

describe('dictionary suggestions and the record of a source', () => {
  const page = () => buildPdf([tablePage([['Geldautomat', 'das', 'ATM'], ['Hund', 'der', 'köpek']])]);
  const accept = (drafts: ImportDraft[]) => drafts.map((draft) => (draft.german === 'Geldautomat' ? { ...draft, article: 'der', edited: true } : draft));
  const target = { kind: 'none' } as const;

  it('keeps what the source said beside what the person chose', async () => {
    const db = await fresh();
    const first = await prepare(db, page());
    await commitImport(db, { source: first.source, drafts: accept(first.drafts), target, collections: first.collections }, 1);
    const rows = await db.importRows.toArray();
    const corrected = rows.find((row) => row.german === 'Geldautomat')!;
    expect(corrected.article).toBe('der');
    expect(corrected.extracted).toEqual({ german: 'Geldautomat', article: 'das', turkish: 'ATM' });
    expect(rows.find((row) => row.german === 'Hund')!.extracted).toBeUndefined();
  });

  it('importing the file again keeps the correction, asks nothing and adds nothing', async () => {
    const db = await fresh();
    const first = await prepare(db, page());
    await commitImport(db, { source: first.source, drafts: accept(first.drafts), target, collections: first.collections }, 1);
    const counts = [await db.words.count(), await db.importRows.count(), await db.groupMembers.count()];

    const again = await prepare(db, page());
    const stored = (await listActiveWords(db)).map(knownEntryOf);
    const rows = reviewRows(again.drafts, stored);
    expect(rows.map((row) => needsAttention(row.status))).toEqual([false, false]);
    expect(rows[0]).toMatchObject({ lemma: 'Geldautomat', article: 'der', status: { kind: 'existing' } });
    await commitImport(db, { source: again.source, drafts: again.drafts, target, collections: again.collections }, 2);

    expect(await db.words.filter((word) => word.lemma === 'Geldautomat').toArray()).toMatchObject([{ article: 'der', updatedAt: 1 }]);
    expect([await db.words.count(), await db.importRows.count(), await db.groupMembers.count()]).toEqual(counts);
  });

  it('a meaning removed since is not brought back by the corrected row', async () => {
    const db = await fresh();
    const first = await prepare(db, page());
    await commitImport(db, { source: first.source, drafts: accept(first.drafts), target, collections: first.collections }, 1);
    const word = (await db.words.filter((item) => item.lemma === 'Geldautomat').first())!;
    await updateWord(db, word.id, { lemma: 'Geldautomat', article: 'der', meanings: ['bankamatik'], plural: null }, 2);

    const again = await prepare(db, page());
    await commitImport(db, { source: again.source, drafts: again.drafts, target, collections: again.collections }, 3);
    expect((await db.words.get(word.id))!.meanings.map((meaning) => meaning.text)).toEqual(['bankamatik']);
  });

  it('a correction that meets an existing word asks a person, and merges nothing by itself', async () => {
    const db = await fresh();
    await addWord(db, { lemma: 'Geldautomat', article: 'der', meanings: ['bankamatik'], plural: null }, null, [], 1);
    const first = await prepare(db, page());
    const rows = reviewRows(accept(first.drafts), (await listActiveWords(db)).map(knownEntryOf));
    expect(rows[0]!.status).toMatchObject({ kind: 'ambiguous', reason: 'meaning', choice: null });
    expect(needsAttention(rows[0]!.status)).toBe(true);
  });

  it('accepted warnings survive in meta, inside the commit and through a backup', async () => {
    const db = await fresh();
    const first = await prepare(db, page());
    const key = dismissalKey('article_wrong', 'Geldautomat', 'das');
    const drafts = first.drafts.map((draft) => (draft.german === 'Geldautomat' ? { ...draft, dismissed: [key] } : draft));
    await commitImport(db, { source: first.source, drafts, target, collections: first.collections }, 1);
    expect([...(await readDismissals(db))]).toEqual([key]);

    const parsed = parseBackup(await exportBackupText(db, 2));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.backup.tables.meta.some((entry) => entry.key === 'dictionaryDismissals')).toBe(true);
    expect((await db.words.filter((word) => word.lemma === 'Geldautomat').first())!.article).toBe('das');
  });

  it('a failed commit records no accepted warning', async () => {
    const db = await fresh();
    const first = await prepare(db, buildPdf([tablePage([['Geldautomat', 'das', '']])]));
    const key = dismissalKey('article_wrong', 'Geldautomat', 'das');
    await expect(commitImport(db, { source: first.source, drafts: first.drafts.map((draft) => ({ ...draft, dismissed: [key] })), target, collections: first.collections }, 1)).rejects.toThrow();
    expect((await readDismissals(db)).size).toBe(0);
  });
});
