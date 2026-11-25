import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, exportBackupText, parseBackup, restoreBackup, type BackupFile, type ParsedBackup } from '../src/data/backup';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { readLearningLanguage, readOnboarding } from '../src/data/learningMeta';
import { countLibrary } from '../src/data/repository';
import { OWNED_TABLES, SCHEMA_VERSION, TABLE_NAMES } from '../src/data/schema';
import { applyLocale } from '../src/i18n/locale';
import { makeCard, makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const open: AppDatabase[] = [];
async function fresh(): Promise<AppDatabase> {
  const db = await openDatabase({ name: uniqueDbName() });
  open.push(db);
  return db;
}
afterEach(() => open.splice(0).forEach((db) => db.close()));

type Tables = Record<string, Record<string, unknown>[]>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const codes = (parsed: ParsedBackup) => (parsed.ok ? [] : parsed.errors.map((e) => e.code));
function expectOk(parsed: ParsedBackup): Extract<ParsedBackup, { ok: true }> {
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed;
}

/** A backup of the seeded German library in the current format. */
async function currentBackup(seed: (db: AppDatabase) => Promise<void> = seedLibrary): Promise<BackupFile> {
  const db = await fresh();
  await seed(db);
  return JSON.parse(await exportBackupText(db, T0)) as BackupFile;
}

/**
 * A backup as the released v1 app wrote it: the same tables, with no learning language anywhere, schema version 1.
 * The current export differs from v1's only by what this takes away.
 */
async function legacyBackup(): Promise<BackupFile> {
  const backup = await currentBackup();
  const tables = backup.tables as Tables;
  for (const name of OWNED_TABLES) tables[name] = tables[name]!.map(({ language: _language, ...rest }) => rest);
  tables.meta = tables.meta!.filter((row) => row.key !== 'learningLanguage' && row.key !== 'onboarding').map((row) => (row.key === 'schemaVersion' ? { ...row, value: 1 } : row));
  return { ...backup, schemaVersion: 1 };
}

const english = async (db: AppDatabase) => {
  await db.words.bulkAdd([makeWord('en-apple', 'apple', null, 'elma', 'en'), makeWord('en-also', 'also', null, 'ayrıca', 'en')]);
  await db.cards.add(makeCard('en-apple', 'tr_de'));
  await db.groups.add({ id: 'g-en', language: 'en', kind: 'custom', name: 'Fruit', order: 5, sourceId: null, createdAt: T0 });
  await db.groupMembers.add({ groupId: 'g-en', wordId: 'en-apple', addedAt: T0, importRowId: null });
  await db.meta.put({ key: 'learningLanguage', value: 'en' });
};
const mixed = async (db: AppDatabase) => {
  await seedLibrary(db);
  await english(db);
};
const text = (backup: unknown) => JSON.stringify(backup);
const meta = (backup: BackupFile, key: string) => backup.tables.meta.find((row) => row.key === key)?.value;
const sortRows = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('backups from before learning languages', () => {
  it('are checked by their own rules, converted to German and accepted', async () => {
    const legacy = await legacyBackup();
    const parsed = expectOk(parseBackup(text(legacy)));
    expect(parsed.contents).toEqual({ words: { de: 5, en: 0 }, groups: 2, reviewLogs: 2, learningLanguage: 'de', legacy: true });
    expect(parsed.backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(meta(parsed.backup, 'learningLanguage')).toBe('de');
    expect(meta(parsed.backup, 'onboarding')).toEqual({ via: 'restore', at: legacy.exportedAt });
  });

  it('keep every id, word, meaning, schedule and history record exactly', async () => {
    const legacy = await legacyBackup();
    const { backup } = expectOk(parseBackup(text(legacy)));
    for (const name of TABLE_NAMES) {
      if (name === 'meta') continue;
      const before = (legacy.tables as Tables)[name]!;
      const expected = (OWNED_TABLES as readonly string[]).includes(name) ? before.map((row) => ({ ...row, language: 'de' })) : before;
      expect(backup.tables[name], name).toEqual(expected);
    }
    expect(backup.tables.meta.filter((row) => row.key !== 'learningLanguage' && row.key !== 'onboarding')).toEqual(legacy.tables.meta);
  });

  it('restore into German, replacing English words, with the learning language and onboarding settled', async () => {
    const target = await fresh();
    await english(target);
    const legacy = await legacyBackup();
    await restoreBackup(target, expectOk(parseBackup(text(legacy))).backup);
    expect(await target.words.where('language').equals('en').count()).toBe(0);
    expect((await target.words.toArray()).map((word) => word.id).sort()).toEqual(legacy.tables.words.map((word) => word.id as string).sort());
    expect(sortRows((await target.cards.toArray()) as unknown as Record<string, unknown>[])).toEqual(sortRows(legacy.tables.cards));
    expect(await target.reviewLogs.toArray()).toEqual(legacy.tables.reviewLogs);
    expect(await readLearningLanguage(target)).toBe('de');
    expect(await readOnboarding(target)).toEqual({ via: 'restore', at: legacy.exportedAt });
  });

  it('are still checked by their own rules first', async () => {
    const broken = await legacyBackup();
    broken.tables.words[0]!.lemma = '';
    expect(codes(parseBackup(text(broken)))).toEqual(['invalid_record']);
  });

  it('are refused when they already say what only later versions write', async () => {
    const named = await legacyBackup();
    named.tables.words[0]!.language = 'en';
    expect(codes(parseBackup(text(named)))).toEqual(['invalid_record']);
    const settled = await legacyBackup();
    settled.tables.meta.push({ key: 'learningLanguage', value: 'de' });
    expect(codes(parseBackup(text(settled)))).toEqual(['invalid_record']);
  });
});

describe('backup versions', () => {
  const withVersions = async (backupVersion: unknown, schemaVersion: unknown) => parseBackup(text({ ...(await currentBackup()), backupVersion, schemaVersion }));

  it('accept exactly the format and schema versions this app knows', async () => {
    expect((await withVersions(1, SCHEMA_VERSION)).ok).toBe(true);
    expect((await withVersions(1, 1)).ok).toBe(false); // A current backup claiming v1 carries languages v1 never had.
    expect(codes(await withVersions(2, SCHEMA_VERSION))).toEqual(['newer_format']);
    for (const odd of [0, -1, 1.5, '1', null]) expect(codes(await withVersions(odd, SCHEMA_VERSION)), String(odd)).toEqual(['not_a_backup']);
    expect(codes(await withVersions(1, SCHEMA_VERSION + 1))).toEqual(['newer_schema']);
    expect(codes(await withVersions(1, 0))).toEqual(['older_schema']);
    expect(codes(await withVersions(1, 1.5))).toEqual(['not_a_backup']);
  });
});

describe('backups with learning languages', () => {
  it('round-trip German only, English only and both, exactly', async () => {
    for (const seed of [seedLibrary, english, mixed]) {
      const source = await fresh();
      await seed(source);
      const before = await createBackup(source, T0);
      const parsed = expectOk(parseBackup(text(before)));
      const target = await fresh();
      await restoreBackup(target, parsed.backup);
      const after = await createBackup(target, T0);
      for (const name of TABLE_NAMES) {
        if (name === 'meta') continue;
        expect(sortRows(after.tables[name]), name).toEqual(sortRows(before.tables[name]));
      }
      expect(await readLearningLanguage(target)).toBe(meta(before, 'learningLanguage'));
      // A backup made before the first-start choice settles it as restored, so no welcome follows a restore.
      expect(await readOnboarding(target)).toEqual(meta(before, 'onboarding') ?? { via: 'restore', at: before.exportedAt });
    }
  });

  it('count each language’s words, leaving out words an older app only marked deleted', async () => {
    const backup = await currentBackup(mixed);
    backup.tables.words.push({ ...makeWord('gone', 'weg', null, 'gitti'), deletedAt: T0 });
    expect(expectOk(parseBackup(text(backup))).contents).toMatchObject({ words: { de: 5, en: 2 }, groups: 3, learningLanguage: 'en', legacy: false });
  });

  it('come from the whole database, whichever language is active, and do not depend on the interface language', async () => {
    const db = await fresh();
    await mixed(db);
    await db.meta.put({ key: 'learningLanguage', value: 'de' });
    const texts: string[] = [];
    for (const locale of ['tr', 'en', 'de'] as const) {
      applyLocale(locale);
      texts.push(text(await createBackup(db, T0)));
    }
    applyLocale('en');
    expect(new Set(texts).size).toBe(1);
    const backup = JSON.parse(texts[0]!) as BackupFile;
    expect(backup.tables.words.filter((word) => word.language === 'en')).toHaveLength(2);
  });

  it('allow the same word and the same file in both languages, but not twice in one', async () => {
    const backup = await currentBackup(mixed);
    backup.tables.words.push({ ...makeWord('en-apfel', 'Apfel', null, 'elma', 'en') });
    backup.tables.sources.push({ ...backup.tables.sources[0]!, id: 's-en', language: 'en' });
    expect(parseBackup(text(backup)).ok).toBe(true);
    const twice = clone(backup);
    twice.tables.words.push({ ...makeWord('en-apple-2', 'apple', null, 'elma', 'en') });
    expect(codes(parseBackup(text(twice)))).toEqual(['duplicate_key']);
    const sameFile = clone(backup);
    sameFile.tables.sources.push({ ...backup.tables.sources[0]!, id: 's-de-2' });
    expect(codes(parseBackup(text(sameFile)))).toEqual(['duplicate_key']);
  });

  it('are refused without a valid learning language on every owned record and in meta', async () => {
    const cases: [string, (tables: Tables) => void][] = [
      ['word fr', (t) => (t.words![0]!.language = 'fr')],
      ['word missing', (t) => delete t.words![0]!.language],
      ['group', (t) => (t.groups![0]!.language = 'DE')],
      ['source', (t) => (t.sources![0]!.language = null)],
      ['meta missing', (t) => (t.meta = t.meta!.filter((row) => row.key !== 'learningLanguage'))],
      ['meta invalid', (t) => (t.meta!.find((row) => row.key === 'learningLanguage')!.value = 'tr')],
    ];
    for (const [label, change] of cases) {
      const backup = await currentBackup(mixed);
      change(backup.tables as Tables);
      expect(codes(parseBackup(text(backup))), label).toEqual(['invalid_language']);
    }
  });

  it('are refused when they link records of different languages', async () => {
    const cases: [string, (tables: Tables) => void][] = [
      ['English word with an article', (t) => (t.words!.find((w) => w.id === 'en-apple')!.article = 'der')],
      ['article card on an English word', (t) => t.cards!.push(makeCard('en-also', 'article') as unknown as Record<string, unknown>)],
      ['German word in an English list', (t) => t.groupMembers!.push({ groupId: 'g-en', wordId: 'w-fuss', addedAt: T0, importRowId: null })],
      ['PDF collection with an English source', (t) => (t.sources!.find((s) => s.id === 's1')!.language = 'en')],
      ['import row from an English source to a German word', (t) => {
        t.sources!.push({ id: 's-en', language: 'en', fileName: 'a.csv', fileHash: 'h-en', importedAt: T0, pipelineVersion: 1 });
        t.importRows!.push({ id: 'r-en', sourceId: 's-en', page: 0, rowIndex: 0, german: 'Fuß', article: 'der', turkish: 'ayak', flags: [], decision: 'existing', wordId: 'w-fuss' });
      }],
    ];
    for (const [label, change] of cases) {
      const backup = await currentBackup(mixed);
      change(backup.tables as Tables);
      expect(codes(parseBackup(text(backup))), label).toContain('language_mismatch');
      expect(codes(parseBackup(text(backup))).every((code) => code === 'language_mismatch'), label).toBe(true);
    }
  });

  it('keep a valid onboarding record, add one when missing, and refuse a malformed one', async () => {
    const kept = await currentBackup(async (db) => {
      await seedLibrary(db);
      await db.meta.put({ key: 'onboarding', value: { via: 'welcome', at: 3 } });
    });
    expect(meta(expectOk(parseBackup(text(kept))).backup, 'onboarding')).toEqual({ via: 'welcome', at: 3 });
    const missing = await currentBackup();
    missing.tables.meta = missing.tables.meta.filter((row) => row.key !== 'onboarding');
    expect(meta(expectOk(parseBackup(text(missing))).backup, 'onboarding')).toEqual({ via: 'restore', at: missing.exportedAt });
    const malformed = await currentBackup();
    malformed.tables.meta.push({ key: 'onboarding', value: { via: 'someday' } });
    expect(codes(parseBackup(text(malformed)))).toEqual(['invalid_record']);
  });
});

describe('restoring', () => {
  it('changes nothing until it is asked to: reading and checking a file writes nothing', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const before = text(await createBackup(db, T0));
    expectOk(parseBackup(text(await currentBackup(english))));
    expect(text(await createBackup(db, T0))).toBe(before);
  });

  it('replaces every language rather than merging, and sets the backup’s learning language and time', async () => {
    const target = await fresh();
    await seedLibrary(target);
    await target.words.add(makeWord('en-kept?', 'kept', null, 'tutuldu', 'en'));
    const backup = await currentBackup(english);
    await restoreBackup(target, expectOk(parseBackup(text(backup))).backup);
    expect((await target.words.toArray()).map((word) => word.id).sort()).toEqual(['en-also', 'en-apple']);
    expect(await target.groups.count()).toBe(1);
    expect(await target.sources.count()).toBe(0);
    expect(await readLearningLanguage(target)).toBe('en');
    expect((await target.meta.get('lastBackupAt'))?.value).toBe(backup.exportedAt);
    expect(await countLibrary(target)).toEqual({ words: { de: 0, en: 2 }, groups: 1, reviewLogs: 0 });
  });

  it('rolls back every table and the learning metadata when it fails midway', async () => {
    const target = await fresh();
    await mixed(target);
    await target.meta.put({ key: 'lastBackupAt', value: 7 });
    const before = text(await createBackup(target, T0));
    const backup = expectOk(parseBackup(text(await currentBackup()))).backup;
    const failing = () => {
      throw new Error('quota exceeded');
    };
    target.meta.hook('creating', failing);
    await expect(restoreBackup(target, backup)).rejects.toBeTruthy();
    target.meta.hook('creating').unsubscribe(failing);
    expect(text(await createBackup(target, T0))).toBe(before);
    expect(await readLearningLanguage(target)).toBe('en');
  });

  it('refuses a backup that was never checked into the current shape', async () => {
    const target = await fresh();
    await seedLibrary(target);
    const raw = await legacyBackup();
    await expect(restoreBackup(target, raw)).rejects.toBeTruthy();
    expect(await target.words.count()).toBe(5);
  });
});
