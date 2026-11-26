import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { exportBackupText, parseBackup, restoreBackup, type BackupFile, type ParsedBackup } from '../src/data/backup';
import { AppDatabase, MigrationFailedError, openDatabase } from '../src/data/db';
import { createCustomGroup, deleteGroups, deleteGroupsWithWords, previewGroupDeletion } from '../src/data/groups';
import { learningMetaEntries } from '../src/data/learningMeta';
import { loadPracticeData } from '../src/data/practice';
import { countLibrary, getGroupWithWords, listActiveWords, listGroupsOfWord, listGroupSummaries } from '../src/data/repository';
import { MIGRATIONS, OWNED_TABLES, SCHEMA_VERSION, TABLE_NAMES } from '../src/data/schema';
import { loadReviewData } from '../src/data/smartReview';
import { makeCard, makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const open: AppDatabase[] = [];
const track = <T extends AppDatabase>(db: T): T => {
  open.push(db);
  return db;
};
afterEach(() => open.splice(0).forEach((db) => db.close()));

type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;

const V1 = MIGRATIONS.filter((migration) => migration.version === 1);
const V2 = MIGRATIONS.filter((migration) => migration.version <= 2);
const V3 = MIGRATIONS.find((migration) => migration.version === 3)!;
const LESSON_IDS = ['g-lesson', 'g-lesson-en'];

async function snapshot(db: AppDatabase): Promise<Snapshot> {
  return Object.fromEntries(await Promise.all(TABLE_NAMES.map(async (table) => [table, await db.table(table).toArray()] as const)));
}

/** What version 3 must leave: the same records, without lessons and their memberships. The schema version is set by opening. */
const withoutLessons = (before: Snapshot, extra: (table: string, rows: Row[]) => Row[] = (_table, rows) => rows): Snapshot =>
  Object.fromEntries(
    TABLE_NAMES.map((table) => {
      let rows = before[table]!;
      if (table === 'groups') rows = rows.filter((group) => group.kind !== 'lesson');
      if (table === 'groupMembers') rows = rows.filter((member) => !LESSON_IDS.includes(member.groupId as string));
      if (table === 'meta') rows = rows.filter((entry) => entry.key !== 'schemaVersion');
      return [table, extra(table, rows)];
    }),
  );
const withoutSchemaVersion = (after: Snapshot): Snapshot => ({ ...after, meta: after.meta!.filter((entry) => entry.key !== 'schemaVersion') });

/**
 * The seeded library with lessons, as earlier versions made them: one German lesson shares der Apfel with the PDF
 * collection and a list, holds der Morgen with the PDF collection only, and is the only collection of Fuß (a card)
 * and Spinat (a favorite with history). An English lesson is the only collection of an English word with a card.
 */
async function seedWithLessons(db: AppDatabase, { english = true } = {}): Promise<void> {
  await seedLibrary(db);
  await db.words.update('w-spinat', { favoritedAt: T0 });
  await db.groupMembers.add({ groupId: 'g-pdf', wordId: 'w-morgen-noun', addedAt: T0, importRowId: null });
  // Stored the way earlier versions stored them: the current types no longer have the kind.
  await db.table('groups').add({ id: 'g-lesson', language: 'de', kind: 'lesson', name: 'Lektion 1', order: 2, sourceId: 's1', createdAt: T0 });
  await db.groupMembers.bulkAdd(
    ['w-apfel', 'w-morgen-noun', 'w-fuss', 'w-spinat'].map((wordId) => ({ groupId: 'g-lesson', wordId, addedAt: T0, importRowId: wordId === 'w-apfel' ? 'r1' : null })),
  );
  if (!english) return;
  await db.words.add(makeWord('en-apple', 'apple', null, 'elma', 'en'));
  await db.cards.add(makeCard('en-apple', 'tr_de'));
  await db.table('groups').add({ id: 'g-lesson-en', language: 'en', kind: 'lesson', name: 'Unit 1', order: 3, sourceId: null, createdAt: T0 });
  await db.groupMembers.add({ groupId: 'g-lesson-en', wordId: 'en-apple', addedAt: T0, importRowId: null });
}

/** A database exactly as Vosli 2.0.0 left one: schema version 2, with lessons. */
async function version2Database(): Promise<{ name: string; before: Snapshot }> {
  const name = uniqueDbName();
  const db = new AppDatabase(name, V2);
  await db.open();
  await seedWithLessons(db);
  await db.meta.bulkPut([...learningMetaEntries('de', { via: 'welcome', at: T0 }), { key: 'schemaVersion', value: 2 }, { key: 'lastBackupAt', value: T0 }]);
  const before = await snapshot(db);
  db.close();
  return { name, before };
}

/** A database as the v1 app left one: no languages, German lessons. */
async function version1Database(): Promise<{ name: string; before: Snapshot }> {
  const name = uniqueDbName();
  const db = new AppDatabase(name, V1);
  await db.open();
  await seedWithLessons(db, { english: false });
  for (const table of OWNED_TABLES) {
    await db.table(table).toCollection().modify((record: Row) => {
      delete record.language;
    });
  }
  await db.meta.bulkPut([{ key: 'schemaVersion', value: 1 }, { key: 'lastBackupAt', value: T0 }]);
  const before = await snapshot(db);
  db.close();
  return { name, before };
}

describe('upgrading to version 3', () => {
  it('removes every lesson and its memberships from a v2 database, and nothing else', async () => {
    const { name, before } = await version2Database();
    expect(before.groups!.filter((group) => group.kind === 'lesson')).toHaveLength(2);
    expect(before.groupMembers).toHaveLength(8);

    const db = track(await openDatabase({ name }));
    expect(db.verno).toBe(3);
    expect(SCHEMA_VERSION).toBe(3);
    expect((await db.meta.get('schemaVersion'))?.value).toBe(3);
    const after = await snapshot(db);
    expect(withoutSchemaVersion(after)).toEqual(withoutLessons(before));
    expect(after.groups!.map((group) => group.id)).toEqual(['g-custom', 'g-pdf']);
    expect(after.groupMembers).toHaveLength(3);
  });

  it('keeps every word, favorite, card and history entry, also of words only a lesson held', async () => {
    const { name, before } = await version2Database();
    const db = track(await openDatabase({ name }));
    for (const table of ['words', 'cards', 'reviewLogs', 'sources', 'importRows'] as const) expect(await db.table(table).toArray(), table).toEqual(before[table]);
    expect((await listActiveWords(db, 'de')).map((word) => word.id).sort()).toEqual(['w-apfel', 'w-fuss', 'w-morgen', 'w-morgen-noun', 'w-spinat']);
    expect((await listActiveWords(db, 'en')).map((word) => word.id)).toEqual(['en-apple']);
    expect((await db.words.get('w-spinat'))?.favoritedAt).toBe(T0);
    expect(await listGroupsOfWord(db, 'w-spinat')).toEqual([]);
    expect(await countLibrary(db)).toEqual({ words: { de: 5, en: 1 }, groups: 2, reviewLogs: 2 });
    // Practice and Smart Review still see them: no word depends on a collection to be studied.
    expect((await loadPracticeData(db, null, 'de')).words.map((word) => word.id)).toContain('w-spinat');
    expect((await loadReviewData(db, null, 'de')).cards.map((card) => card.wordId)).toContain('w-fuss');
    expect((await loadReviewData(db, null, 'en')).cards.map((card) => card.wordId)).toEqual(['en-apple']);
    expect((await listGroupSummaries(db, 'de')).map((summary) => [summary.group.id, summary.wordCount])).toEqual([['g-pdf', 2], ['g-custom', 1]]);
  });

  it('takes a v1 database through both upgrades: German everywhere, no lessons, everything else kept', async () => {
    const { name, before } = await version1Database();
    const db = track(await openDatabase({ name }));
    expect(db.verno).toBe(3);
    const after = await snapshot(db);
    const expected = withoutLessons(before, (table, rows) => ((OWNED_TABLES as readonly string[]).includes(table) ? rows.map((row) => ({ ...row, language: 'de' })) : rows));
    for (const table of TABLE_NAMES) {
      if (table === 'meta') continue;
      expect(after[table], table).toEqual(expected[table]);
    }
    expect(await db.meta.get('learningLanguage')).toMatchObject({ value: 'de' });
    expect((await db.meta.get('onboarding'))?.value).toMatchObject({ via: 'legacy' });
    expect((await db.meta.get('lastBackupAt'))?.value).toBe(T0);
  });

  it('rolls a failed removal back completely, and succeeds when tried again', async () => {
    const { name, before } = await version2Database();
    const broken = { ...V3, upgrade: async (tx: Parameters<NonNullable<typeof V3.upgrade>>[0]) => {
      await V3.upgrade!(tx);
      throw new Error('interrupted');
    } };
    await expect(openDatabase({ name, migrations: [...V2, broken] })).rejects.toBeInstanceOf(MigrationFailedError);

    const untouched = new AppDatabase(name, V2);
    await untouched.open();
    expect(untouched.verno).toBe(2);
    expect(await snapshot(untouched)).toEqual(before);
    untouched.close();

    const db = track(await openDatabase({ name }));
    expect(await db.groups.toArray()).toHaveLength(2);
    expect(await db.words.count()).toBe(before.words!.length);
  });

  it('changes nothing in a v2 database without lessons', async () => {
    const name = uniqueDbName();
    const old = new AppDatabase(name, V2);
    await old.open();
    await seedLibrary(old);
    const before = await snapshot(old);
    old.close();
    const db = track(await openDatabase({ name }));
    expect(withoutSchemaVersion(await snapshot(db))).toEqual(withoutSchemaVersion(before));
  });

  it('starts a new installation at version 3 with the same stores and indexes', async () => {
    const db = track(await openDatabase({ name: uniqueDbName() }));
    expect(db.verno).toBe(3);
    expect(db.backendDB().version).toBe(30);
    expect([...db.backendDB().objectStoreNames].sort()).toEqual([...TABLE_NAMES].sort());
    expect(db.groups.schema.indexes.map((index) => index.name).sort()).toEqual(['kind', 'language', 'order']);
    expect(db.words.schema.indexes.map((index) => index.name)).toContain('[language+identityKey]');
    const list = await createCustomGroup(db, 'Listem', T0, 'de');
    expect(await db.groups.get(list.id)).toMatchObject({ kind: 'custom' });
  });
});

describe('deleting a collection after the lessons are gone', () => {
  it('counts a word the PDF collection shared only with a lesson as its own, and deletes it only when confirmed', async () => {
    const { name } = await version2Database();
    const db = track(await openDatabase({ name }));
    const words = await db.words.count();

    // der Morgen was shared with the lesson; der Apfel is still shared with a list.
    expect(await previewGroupDeletion(db, ['g-pdf'])).toEqual({ ownWordIds: ['w-morgen-noun'], sharedCount: 1 });
    // Deleting only the collection never deletes a word.
    await deleteGroups(db, ['g-pdf']);
    expect(await db.words.count()).toBe(words);
    expect(await db.cards.count()).toBe(4);
  });

  it('removes only the words the learner confirmed, and never a shared one', async () => {
    const { name } = await version2Database();
    const db = track(await openDatabase({ name }));
    const words = await db.words.count();
    await deleteGroupsWithWords(db, ['g-pdf'], []);
    expect(await db.words.count()).toBe(words);

    const again = track(await openDatabase({ name: (await version2Database()).name }));
    const { ownWordIds } = await previewGroupDeletion(again, ['g-pdf']);
    await deleteGroupsWithWords(again, ['g-pdf'], ownWordIds);
    expect(await again.words.get('w-morgen-noun')).toBeUndefined();
    expect(await again.words.get('w-apfel')).toMatchObject({ deletedAt: null });
    expect((await getGroupWithWords(again, 'g-custom', 'de'))?.words.map((word) => word.id)).toEqual(['w-apfel']);
    expect(await again.cards.where('wordId').equals('w-apfel').count()).toBe(2);
    expect(await again.words.count()).toBe(words - 1);
  });
});

describe('backups with lessons', () => {
  const expectOk = (parsed: ParsedBackup) => {
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed;
  };
  const codes = (parsed: ParsedBackup) => (parsed.ok ? [] : parsed.errors.map((error) => `${error.code} ${error.detail}`));

  /** A backup as Vosli 2.0.0 wrote it: the current shape, schema version 2, lessons included. */
  async function version2Backup(): Promise<BackupFile> {
    const db = track(await openDatabase({ name: uniqueDbName() }));
    await seedWithLessons(db);
    const backup = JSON.parse(await exportBackupText(db, T0)) as BackupFile;
    backup.tables.meta = backup.tables.meta.map((row) => (row.key === 'schemaVersion' ? { ...row, value: 2 } : row));
    return { ...backup, schemaVersion: 2 };
  }

  /** A backup as the v1 app wrote it: no languages, schema version 1, German lessons. */
  async function version1Backup(): Promise<BackupFile> {
    const db = track(await openDatabase({ name: uniqueDbName() }));
    await seedWithLessons(db, { english: false });
    const backup = JSON.parse(await exportBackupText(db, T0)) as BackupFile;
    const tables = backup.tables as Record<string, Row[]>;
    for (const name of OWNED_TABLES) tables[name] = tables[name]!.map(({ language: _language, ...rest }) => rest);
    tables.meta = tables.meta!.filter((row) => row.key !== 'learningLanguage' && row.key !== 'onboarding').map((row) => (row.key === 'schemaVersion' ? { ...row, value: 1 } : row));
    return { ...backup, schemaVersion: 1 };
  }

  const lessonFree = (tables: BackupFile['tables']) => ({
    groups: tables.groups.filter((group) => group.kind !== 'lesson'),
    groupMembers: tables.groupMembers.filter((member) => !LESSON_IDS.includes(member.groupId as string)),
  });

  it('reads a v2 backup without its lessons, and counts only the collections that will be restored', async () => {
    const original = await version2Backup();
    const parsed = expectOk(parseBackup(JSON.stringify(original)));
    expect(parsed.backup.schemaVersion).toBe(3);
    expect(parsed.backup.tables.groups).toEqual(lessonFree(original.tables).groups);
    expect(parsed.backup.tables.groupMembers).toEqual(lessonFree(original.tables).groupMembers);
    for (const table of ['words', 'cards', 'reviewLogs', 'sources', 'importRows'] as const) expect(parsed.backup.tables[table], table).toEqual(original.tables[table]);
    expect(parsed.contents).toEqual({ words: { de: 5, en: 1 }, groups: 2, reviewLogs: 2, learningLanguage: 'de', legacy: false });
    expect(parsed.counts).toMatchObject({ groups: 2, groupMembers: 3, words: 6, cards: 4 });
  });

  it('restores a v2 backup with every word and no lesson', async () => {
    const original = await version2Backup();
    const target = track(await openDatabase({ name: uniqueDbName() }));
    await restoreBackup(target, expectOk(parseBackup(JSON.stringify(original))).backup);
    expect(await target.groups.where('kind').equals('lesson').count()).toBe(0);
    expect((await target.groups.toArray()).map((group) => group.id).sort()).toEqual(['g-custom', 'g-pdf']);
    expect(await target.words.toArray()).toEqual(original.tables.words);
    expect(await target.cards.count()).toBe(original.tables.cards.length);
    expect(await target.reviewLogs.toArray()).toEqual(original.tables.reviewLogs);
    expect((await target.words.get('w-spinat'))?.favoritedAt).toBe(T0);
    expect((await target.meta.get('schemaVersion'))?.value).toBe(3);
  });

  it('converts a v1 backup to German without its lessons', async () => {
    const original = await version1Backup();
    const parsed = expectOk(parseBackup(JSON.stringify(original)));
    expect(parsed.contents).toEqual({ words: { de: 5, en: 0 }, groups: 2, reviewLogs: 2, learningLanguage: 'de', legacy: true });
    expect(parsed.backup.tables.groups).toEqual(lessonFree(original.tables).groups.map((group) => ({ ...group, language: 'de' })));
    expect(parsed.backup.tables.groupMembers).toEqual(lessonFree(original.tables).groupMembers);
    expect(parsed.backup.tables.words).toEqual(original.tables.words.map((word) => ({ ...word, language: 'de' })));
    const target = track(await openDatabase({ name: uniqueDbName() }));
    await restoreBackup(target, parsed.backup);
    expect(await target.groups.count()).toBe(2);
    expect(await target.words.count()).toBe(5);
  });

  it('still refuses an older backup whose lesson is damaged, or whose membership points nowhere', async () => {
    const damaged = await version2Backup();
    damaged.tables.groups = damaged.tables.groups.map((group) => (group.id === 'g-lesson' ? { ...group, name: 7 } : group));
    expect(codes(parseBackup(JSON.stringify(damaged)))).toContain(`invalid_record groups[${damaged.tables.groups.findIndex((group) => group.id === 'g-lesson')}]`);

    const dangling = await version2Backup();
    dangling.tables.groupMembers.push({ groupId: 'g-missing', wordId: 'w-apfel', addedAt: T0, importRowId: null });
    expect(codes(parseBackup(JSON.stringify(dangling)))[0]).toMatch(/^broken_reference/);

    const legacyDamaged = await version1Backup();
    legacyDamaged.tables.groups = legacyDamaged.tables.groups.map((group) => (group.id === 'g-lesson' ? { ...group, kind: 'chapter' } : group));
    expect(parseBackup(JSON.stringify(legacyDamaged)).ok).toBe(false);
  });

  it('refuses a version 3 backup that holds a lesson: the app never writes one', async () => {
    const db = track(await openDatabase({ name: uniqueDbName() }));
    await seedLibrary(db);
    const backup = JSON.parse(await exportBackupText(db, T0)) as BackupFile;
    expect(backup.schemaVersion).toBe(3);
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
    backup.tables.groups.push({ id: 'g-lesson', language: 'de', kind: 'lesson', name: 'Lektion 1', order: 2, sourceId: null, createdAt: T0 });
    expect(codes(parseBackup(JSON.stringify(backup)))).toEqual([`invalid_record groups[${backup.tables.groups.length - 1}]`]);
  });

  it('keeps refusing schema versions it does not know', async () => {
    const backup = await version2Backup();
    expect(codes(parseBackup(JSON.stringify({ ...backup, schemaVersion: 0 })))).toEqual(['older_schema 0']);
    expect(codes(parseBackup(JSON.stringify({ ...backup, schemaVersion: 4 })))).toEqual(['newer_schema 4']);
  });
});
