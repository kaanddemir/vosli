import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { blankDraft, SEPARATE } from '../src/core/review';
import { AppDatabase, MigrationFailedError, openDatabase } from '../src/data/db';
import { addWordsToGroup, createCustomGroup, GroupNameError, restoreGroupMembers, setWordCustomGroups } from '../src/data/groups';
import { commitImport } from '../src/data/importCommit';
import { completeOnboarding, readLearningLanguage, readOnboarding, saveLearningLanguage } from '../src/data/learningMeta';
import { loadPracticeData } from '../src/data/practice';
import { countLibrary, listActiveWords, listCustomGroups, listGroupSummaries } from '../src/data/repository';
import { MIGRATIONS, OWNED_TABLES, SCHEMA_VERSION, TABLE_NAMES } from '../src/data/schema';
import { loadReviewData } from '../src/data/smartReview';
import type { LearningLanguage } from '../src/data/types';
import { addWord, insertWord, LanguageMismatchError, updateWord } from '../src/data/words';
import { makeCard, makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const open: AppDatabase[] = [];
const track = <T extends AppDatabase>(db: T): T => {
  open.push(db);
  return db;
};
afterEach(() => open.splice(0).forEach((db) => db.close()));

const V1 = MIGRATIONS.filter((migration) => migration.version === 1);
type Snapshot = Record<string, Record<string, unknown>[]>;

/**
 * A database exactly as the released v1 app left one: opened with v1 alone, so nothing of later versions runs, and
 * records without a language, as v1 wrote them.
 */
async function legacyDatabase(seed: (db: AppDatabase) => Promise<void> = seedLibrary): Promise<{ name: string; before: Snapshot }> {
  const name = uniqueDbName();
  const db = new AppDatabase(name, V1);
  await db.open();
  await seed(db);
  for (const table of OWNED_TABLES) {
    await db.table(table).toCollection().modify((record: Record<string, unknown>) => {
      delete record.language;
    });
  }
  await db.meta.bulkPut([
    { key: 'schemaVersion', value: 1 },
    { key: 'lastBackupAt', value: T0 },
    { key: 'dictionaryDismissals', value: ['dict:spelling||Apfel'] },
  ]);
  const before = await snapshot(db);
  db.close();
  return { name, before };
}

async function snapshot(db: AppDatabase): Promise<Snapshot> {
  return Object.fromEntries(await Promise.all(TABLE_NAMES.map(async (table) => [table, await db.table(table).toArray()] as const)));
}

const byId = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.id ?? a.key ?? a.seq).localeCompare(String(b.id ?? b.key ?? b.seq)));
const draft = (lemma: string, article: 'der' | 'die' | 'das' | null, meaning: string) => ({ lemma, article, meanings: [meaning], plural: null });

describe('upgrading a database from before learning languages', () => {
  it('makes every word, collection and source German and keeps everything else exactly', async () => {
    const { name, before } = await legacyDatabase();
    expect(before.words!.every((word) => !('language' in word))).toBe(true);

    const db = track(await openDatabase({ name }));
    const after = await snapshot(db);
    for (const table of TABLE_NAMES) {
      if (table === 'meta') continue;
      const expected = (OWNED_TABLES as readonly string[]).includes(table) ? before[table]!.map((row) => ({ ...row, language: 'de' })) : before[table];
      expect(byId(after[table]!), table).toEqual(byId(expected!));
    }
    // Ids, schedules and history are the same records, in the same order of their keys.
    expect(after.cards).toEqual(before.cards);
    expect(after.reviewLogs).toEqual(before.reviewLogs);
    expect(db.verno).toBe(SCHEMA_VERSION);
  });

  it('marks its owner as a learner from before languages, in German, and keeps the other settings', async () => {
    const { name } = await legacyDatabase();
    const db = track(await openDatabase({ name }));
    expect(await readLearningLanguage(db)).toBe('de');
    expect(await readOnboarding(db)).toMatchObject({ via: 'legacy' });
    expect((await db.meta.get('lastBackupAt'))?.value).toBe(T0);
    expect((await db.meta.get('dictionaryDismissals'))?.value).toEqual(['dict:spelling||Apfel']);
    expect((await db.meta.get('schemaVersion'))?.value).toBe(SCHEMA_VERSION);
  });

  it('recognizes a learner from before even with no words at all', async () => {
    const { name } = await legacyDatabase(async () => undefined);
    const db = track(await openDatabase({ name }));
    expect(await db.words.count()).toBe(0);
    expect(await readOnboarding(db)).toMatchObject({ via: 'legacy' });
    expect(await readLearningLanguage(db)).toBe('de');
  });

  it('leaves a new database without a first-start record, however often it opens, so the welcome appears', async () => {
    const name = uniqueDbName();
    const first = await openDatabase({ name });
    expect(await readOnboarding(first)).toBeNull();
    expect(await readLearningLanguage(first)).toBe('de');
    first.close();
    const again = track(await openDatabase({ name }));
    expect(await readOnboarding(again)).toBeNull();
    expect(await again.meta.get('learningLanguage')).toBeUndefined();
  });

  it('keeps an interim default record from earlier builds: that learner is never welcomed again', async () => {
    const name = uniqueDbName();
    const first = await openDatabase({ name });
    await first.meta.bulkPut([
      { key: 'learningLanguage', value: 'de' },
      { key: 'onboarding', value: { via: 'default', at: 7 } },
    ]);
    first.close();
    const again = track(await openDatabase({ name }));
    expect(await readOnboarding(again)).toEqual({ via: 'default', at: 7 });
  });

  it('saves the welcome choice, language and record together, and never over a settled one', async () => {
    const db = track(await openDatabase({ name: uniqueDbName() }));
    expect(await completeOnboarding(db, 'en', 11)).toEqual({ via: 'welcome', at: 11 });
    expect(await readLearningLanguage(db)).toBe('en');
    // A second tab finishing the same welcome changes nothing that is settled.
    expect(await completeOnboarding(db, 'de', 12)).toEqual({ via: 'welcome', at: 11 });
    expect(await readLearningLanguage(db)).toBe('en');
  });

  it('writes neither part of the welcome choice when saving fails', async () => {
    const db = track(await openDatabase({ name: uniqueDbName() }));
    const failing = () => {
      throw new Error('quota exceeded');
    };
    db.meta.hook('creating', failing);
    await expect(completeOnboarding(db, 'en', 11)).rejects.toBeTruthy();
    db.meta.hook('creating').unsubscribe(failing);
    expect(await readOnboarding(db)).toBeNull();
    expect(await db.meta.get('learningLanguage')).toBeUndefined();
  });

  it('switches the workspace without touching how it was first settled, or any schedule', async () => {
    const db = track(await openDatabase({ name: uniqueDbName() }));
    await seedLibrary(db);
    await completeOnboarding(db, 'de', 1);
    const cards = await db.cards.toArray();
    await saveLearningLanguage(db, 'en');
    expect(await readLearningLanguage(db)).toBe('en');
    expect(await readOnboarding(db)).toEqual({ via: 'welcome', at: 1 });
    expect(await db.cards.toArray()).toEqual(cards);
  });

  it('never changes a settled learning language or onboarding on a later start', async () => {
    const name = uniqueDbName();
    const first = await openDatabase({ name });
    await first.meta.bulkPut([
      { key: 'learningLanguage', value: 'en' },
      { key: 'onboarding', value: { via: 'restore', at: 42 } },
    ]);
    first.close();
    const again = track(await openDatabase({ name }));
    expect(await readLearningLanguage(again)).toBe('en');
    expect(await readOnboarding(again)).toEqual({ via: 'restore', at: 42 });
  });

  it('rolls a failed upgrade back completely, and succeeds when tried again', async () => {
    const { name, before } = await legacyDatabase();
    const real = MIGRATIONS.find((migration) => migration.version === 2)!;
    const broken = { ...real, upgrade: async (tx: Parameters<NonNullable<typeof real.upgrade>>[0]) => {
      await real.upgrade!(tx);
      throw new Error('interrupted');
    } };
    await expect(openDatabase({ name, migrations: [...V1, broken] })).rejects.toBeInstanceOf(MigrationFailedError);

    const untouched = new AppDatabase(name, V1);
    await untouched.open();
    expect(untouched.verno).toBe(1);
    expect(await snapshot(untouched)).toEqual(before);
    untouched.close();

    const db = track(await openDatabase({ name }));
    expect(await db.words.where('language').equals('de').count()).toBe(before.words!.length);
    expect(await readOnboarding(db)).toMatchObject({ via: 'legacy' });
  });
});

describe('the database keeps learning languages apart', () => {
  const fresh = async () => track(await openDatabase({ name: uniqueDbName() }));

  it('lets the same spelling be a word in both languages, once in each', async () => {
    const db = await fresh();
    await db.words.bulkAdd([makeWord('de-also', 'also', null, 'yani'), makeWord('en-also', 'also', null, 'ayrıca', 'en')]);
    await expect(db.words.add(makeWord('de-also-2', 'also', null, 'öyleyse'))).rejects.toMatchObject({ name: 'ConstraintError' });
    await expect(db.words.add(makeWord('en-also-2', 'also', null, 'de', 'en'))).rejects.toMatchObject({ name: 'ConstraintError' });
  });

  it('lets the same file be a source in both languages, once in each', async () => {
    const db = await fresh();
    const source = (id: string, language: LearningLanguage) => ({ id, language, fileName: 'a.pdf', fileHash: 'same', importedAt: T0, pipelineVersion: 1 });
    await db.sources.bulkAdd([source('s-de', 'de'), source('s-en', 'en')]);
    await expect(db.sources.add(source('s-de-2', 'de'))).rejects.toMatchObject({ name: 'ConstraintError' });
  });

  it('compares a new word only with its own language', async () => {
    const db = await fresh();
    const german = await addWord(db, draft('also', null, 'yani'), null, [], T0, 'de');
    const english = await addWord(db, draft('also', null, 'yani'), null, [], T0, 'en');
    expect(german.kind).toBe('saved');
    expect(english.kind).toBe('saved');
    if (german.kind !== 'saved' || english.kind !== 'saved') return;
    expect(english.word.id).not.toBe(german.word.id);
    expect(english.word.language).toBe('en');
    expect(english.word.identityKey).toBe(german.word.identityKey);
    // Within a language the existing rules still apply: the same word again joins it.
    const repeat = await addWord(db, draft('also', null, 'yani'), null, [], T0, 'en');
    expect(repeat.kind).toBe('conflict');
  });

  it('refuses German articles on words of another language', async () => {
    const db = await fresh();
    await expect(addWord(db, draft('Apple', 'der', 'elma'), null, [], T0, 'en')).rejects.toBeInstanceOf(LanguageMismatchError);
    const saved = await addWord(db, draft('apple', null, 'elma'), null, [], T0, 'en');
    if (saved.kind !== 'saved') throw new Error('not saved');
    await expect(updateWord(db, saved.word.id, draft('apple', 'die', 'elma'), T0)).rejects.toBeInstanceOf(LanguageMismatchError);
    expect(await db.words.count()).toBe(1);
    expect((await db.words.get(saved.word.id))?.article).toBeNull();
  });

  it('never links a word to a collection of another language, and writes nothing when asked to', async () => {
    const db = await fresh();
    const germanList = await createCustomGroup(db, 'Liste', T0, 'de');
    const english = await db.transaction('rw', [db.words, db.cards, db.reviewLogs, db.groupMembers, db.importRows], () => insertWord(db, draft('apple', null, 'elma'), T0, 'en'));

    await expect(addWordsToGroup(db, germanList.id, [english.id], T0)).rejects.toBeInstanceOf(LanguageMismatchError);
    await expect(setWordCustomGroups(db, english.id, [germanList.id], T0)).rejects.toBeInstanceOf(LanguageMismatchError);
    await expect(restoreGroupMembers(db, [{ groupId: germanList.id, wordId: english.id, addedAt: T0, importRowId: null }])).rejects.toBeInstanceOf(LanguageMismatchError);
    await expect(addWord(db, draft('pear', null, 'armut'), null, [germanList.id], T0, 'en')).rejects.toBeInstanceOf(LanguageMismatchError);
    expect(await db.groupMembers.count()).toBe(0);
    expect((await db.words.toArray()).map((word) => word.lemma)).toEqual(['apple']);
  });

  it('keeps collection names unique within a language only', async () => {
    const db = await fresh();
    await createCustomGroup(db, 'Week 1', T0, 'de');
    await expect(createCustomGroup(db, 'Week 1', T0, 'en')).resolves.toMatchObject({ language: 'en' });
    await expect(createCustomGroup(db, 'week 1', T0, 'de')).rejects.toMatchObject({ problem: 'taken' } satisfies Partial<GroupNameError>);
  });

  it('imports into one language: another language’s source, words and collections are never reused', async () => {
    const db = await fresh();
    const rows = [blankDraft('1', 0, { german: 'Apfel', article: 'der', turkish: 'elma' })];
    const german = await commitImport(db, { source: { language: 'de', fileName: 'a.csv', fileHash: 'same', pipelineVersion: 1 }, drafts: rows, target: { kind: 'none' } }, T0);
    const englishRows = [blankDraft('2', 0, { german: 'apple', article: '', turkish: 'elma' })];
    const english = await commitImport(db, { source: { language: 'en', fileName: 'a.csv', fileHash: 'same', pipelineVersion: 1 }, drafts: englishRows, target: { kind: 'new_group', name: 'Fruit' } }, T0);

    expect(german.created).toBe(1);
    expect(english.created).toBe(1);
    expect(english.sourceReused).toBe(false);
    const sources = await db.sources.toArray();
    expect(sources.map((source) => source.language).sort()).toEqual(['de', 'en']);
    const englishWord = (await db.words.where('language').equals('en').toArray())[0]!;
    const englishSource = sources.find((source) => source.language === 'en')!;
    expect((await db.importRows.where('sourceId').equals(englishSource.id).toArray()).map((row) => row.wordId)).toEqual([englishWord.id]);
    expect(english.group?.language).toBe('en');

    const germanList = await createCustomGroup(db, 'Liste', T0, 'de');
    await expect(commitImport(db, { source: { language: 'en', fileName: '', fileHash: 'other', pipelineVersion: 1 }, drafts: [blankDraft('3', 0, { german: 'pear', turkish: 'armut' })], target: { kind: 'group', id: germanList.id } }, T0)).rejects.toBeInstanceOf(LanguageMismatchError);
    expect(await db.words.where('language').equals('en').count()).toBe(1);
  });

  it('lists, counts and studies one language at a time', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await db.words.bulkAdd([makeWord('en-apple', 'apple', null, 'elma', 'en'), makeWord('en-pear', 'pear', null, 'armut', 'en')]);
    await db.cards.add(makeCard('en-apple', 'de_tr'));
    const englishList = await createCustomGroup(db, 'Fruit', T0, 'en');
    await addWordsToGroup(db, englishList.id, ['en-apple'], T0);

    expect((await listActiveWords(db, 'en')).map((word) => word.id).sort()).toEqual(['en-apple', 'en-pear']);
    expect((await listActiveWords(db, 'de')).every((word) => word.language === 'de')).toBe(true);
    expect((await listGroupSummaries(db, 'en')).map((summary) => [summary.group.name, summary.wordCount])).toEqual([['Fruit', 1]]);
    expect((await listGroupSummaries(db, 'de')).map((summary) => summary.group.id)).toEqual(['g-pdf', 'g-custom']);
    expect((await listCustomGroups(db, 'de')).map((group) => group.id)).toEqual(['g-custom']);

    const review = await loadReviewData(db, null, 'de');
    expect(review.cards.some((card) => card.wordId === 'en-apple')).toBe(false);
    const english = await loadReviewData(db, null, 'en');
    expect(english.cards.map((card) => card.wordId)).toEqual(['en-apple']);
    const practice = await loadPracticeData(db, null, 'en');
    expect(practice.members.map((member) => member.wordId)).toEqual(['en-apple']);
    expect(practice.history).toEqual([]);

    expect(await countLibrary(db)).toEqual({ words: { de: 5, en: 2 }, groups: 3, reviewLogs: 2 });
  });

  it('keeps the German rules for German words', async () => {
    const db = await fresh();
    const first = await addWord(db, draft('See', 'der', 'göl'), null, [], T0, 'de');
    const second = await addWord(db, draft('See', 'die', 'deniz'), null, [], T0, 'de');
    expect(first.kind).toBe('saved');
    expect(second.kind).toBe('conflict');
    const separate = await addWord(db, draft('See', 'die', 'deniz'), SEPARATE, [], T0, 'de');
    expect(separate.kind).toBe('saved');
    expect(await db.words.where('language').equals('de').count()).toBe(2);
  });
});
