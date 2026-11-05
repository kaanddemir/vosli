import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, exportBackupText, parseBackup, restoreBackup, type BackupFile, type ParsedBackup } from '../src/data/backup';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { SCHEMA_VERSION } from '../src/data/schema';
import { makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const open: AppDatabase[] = [];
async function fresh(): Promise<AppDatabase> {
  const db = await openDatabase({ name: uniqueDbName() });
  open.push(db);
  return db;
}
afterEach(() => open.splice(0).forEach((db) => db.close()));

function expectOk(parsed: ParsedBackup): BackupFile {
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.backup;
}
const codes = (parsed: ParsedBackup) => (parsed.ok ? [] : parsed.errors.map((e) => e.code));

async function validBackup(): Promise<BackupFile> {
  const db = await fresh();
  await seedLibrary(db);
  return JSON.parse(await exportBackupText(db, T0)) as BackupFile;
}

describe('backup round trip', () => {
  it('restores every table exactly', async () => {
    const source = await fresh();
    await seedLibrary(source);
    const text = await exportBackupText(source, T0);
    const before = await createBackup(source, T0);

    const target = await fresh();
    await target.words.add(makeWord('old', 'Alt', null, 'eski'));
    await restoreBackup(target, expectOk(parseBackup(text)));
    const after = await createBackup(target, T0);

    expect(after.tables.words).toEqual(before.tables.words);
    expect(after.tables.cards).toEqual(before.tables.cards);
    expect(after.tables.reviewLogs).toEqual(before.tables.reviewLogs);
    expect(after.tables.groups).toEqual(before.tables.groups);
    expect(after.tables.groupMembers).toEqual(before.tables.groupMembers);
    expect(after.tables.sources).toEqual(before.tables.sources);
    expect(after.tables.importRows).toEqual(before.tables.importRows);
    expect(await target.words.get('old')).toBeUndefined();
  });

  it('keeps German and Turkish characters intact', async () => {
    const source = await fresh();
    await seedLibrary(source);
    const target = await fresh();
    await restoreBackup(target, expectOk(parseBackup(await exportBackupText(source, T0))));
    expect((await target.words.get('w-fuss'))?.lemma).toBe('Fuß');
    expect((await target.words.get('w-spinat'))?.meanings[0]?.text).toBe('ıspanak');
  });

  it('accepts a file with a byte order mark', async () => {
    const source = await fresh();
    expect(parseBackup(`﻿${await exportBackupText(source, T0)}`).ok).toBe(true);
  });

  it('gives new logs a higher sequence after restore', async () => {
    const source = await fresh();
    await seedLibrary(source);
    const text = await exportBackupText(source, T0);
    const target = await fresh();
    await restoreBackup(target, expectOk(parseBackup(text)));
    const max = (await target.reviewLogs.orderBy('seq').last())?.seq ?? 0;
    const seq = await target.reviewLogs.add({ mode: 'practice', wordId: 'w-apfel', track: 'de_tr', at: T0, typed: 'x', result: 'wrong', hintsUsed: 0 });
    expect(seq).toBeGreaterThan(max);
  });

  it('records the backup time', async () => {
    const db = await fresh();
    await exportBackupText(db, T0);
    expect((await db.meta.get('lastBackupAt'))?.value).toBe(T0);
  });

  it('leaves existing data untouched when a restore fails midway', async () => {
    const source = await fresh();
    await seedLibrary(source);
    const backup = expectOk(parseBackup(await exportBackupText(source, T0)));
    const target = await fresh();
    await target.words.add(makeWord('keep', 'Bleiben', null, 'kalmak'));
    const failing = () => {
      throw new Error('disk full');
    };
    target.groups.hook('creating', failing);
    await expect(restoreBackup(target, backup)).rejects.toBeTruthy();
    target.groups.hook('creating').unsubscribe(failing);
    expect((await target.words.toArray()).map((w) => w.id)).toEqual(['keep']);
    expect(await target.cards.count()).toBe(0);
  });
});

describe('backup validation', () => {
  it('rejects text that is not JSON', () => expect(codes(parseBackup('hello'))).toEqual(['not_json']));
  it('rejects JSON from another app', () => expect(codes(parseBackup('{"app":"other","tables":{}}'))).toEqual(['not_a_backup']));

  it('rejects a backup from a newer schema', async () => {
    const backup = await validBackup();
    expect(codes(parseBackup(JSON.stringify({ ...backup, schemaVersion: SCHEMA_VERSION + 1 })))).toEqual(['newer_schema']);
  });

  it('rejects a newer backup format', async () => {
    const backup = await validBackup();
    expect(codes(parseBackup(JSON.stringify({ ...backup, backupVersion: 99 })))).toEqual(['newer_format']);
  });

  it('rejects a missing table', async () => {
    const backup = await validBackup();
    const { cards: _cards, ...tables } = backup.tables;
    expect(codes(parseBackup(JSON.stringify({ ...backup, tables })))).toContain('invalid_record');
  });

  it('rejects a malformed word instead of skipping it', async () => {
    const backup = await validBackup();
    delete backup.tables.words[0]!.lemma;
    const parsed = parseBackup(JSON.stringify(backup));
    expect(codes(parsed)).toEqual(['invalid_record']);
    expect(parsed.ok ? '' : parsed.errors[0]?.detail).toBe('words[0]');
  });

  it('rejects an FSRS state with a date string, which the scheduler could not use', async () => {
    const backup = await validBackup();
    (backup.tables.cards[0]!.fsrs as Record<string, unknown>).dueAt = '2026-01-01T00:00:00Z';
    expect(codes(parseBackup(JSON.stringify(backup)))).toContain('invalid_record');
  });

  it('rejects a card whose due index disagrees with its state', async () => {
    const backup = await validBackup();
    backup.tables.cards[0]!.due = 1;
    expect(codes(parseBackup(JSON.stringify(backup)))).toContain('invalid_record');
  });

  it('rejects a practice log carrying scheduling fields', async () => {
    const backup = await validBackup();
    const log = backup.tables.reviewLogs.find((row) => row.mode === 'practice')!;
    log.grade = 'good';
    expect(codes(parseBackup(JSON.stringify(backup)))).toContain('invalid_record');
  });

  it('rejects duplicate identities, which would fail on write', async () => {
    const backup = await validBackup();
    backup.tables.words.push({ ...backup.tables.words[0]!, id: 'another-id' });
    expect(codes(parseBackup(JSON.stringify(backup)))).toContain('duplicate_key');
  });

  it('rejects references to missing records', async () => {
    const backup = await validBackup();
    backup.tables.cards[0]!.wordId = 'ghost';
    expect(codes(parseBackup(JSON.stringify(backup)))).toContain('broken_reference');
  });
});
