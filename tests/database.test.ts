import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { applyGrade } from '../src/core/scheduling/fsrs';
import { MigrationFailedError, NewerSchemaError, openDatabase, type AppDatabase } from '../src/data/db';
import { getActiveWord, getGroupWithWords, isBackupDue, listActiveWords, listGroupsOfWord, listGroupSummaries, recordPracticeAttempt } from '../src/data/repository';
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from '../src/data/schema';
import { saveReview } from '../src/data/smartReview';
import { makeCard, makeFsrs, makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const open: AppDatabase[] = [];
async function fresh(): Promise<AppDatabase> {
  const db = await openDatabase({ name: uniqueDbName() });
  open.push(db);
  return db;
}
afterEach(() => open.splice(0).forEach((db) => db.close()));

const apfel = makeWord('w-apfel', 'Apfel', 'der', 'elma');
const answer = { word: apfel, track: 'de_tr' as const, expected: makeFsrs(T0), typed: 'elma', result: 'correct' as const, correct: true, hinted: false, at: T0, sessionId: 's1', retry: false };
async function withCard(db: AppDatabase): Promise<void> {
  await db.words.add(apfel);
  await db.cards.add(makeCard('w-apfel'));
}

describe('schema', () => {
  it('records its version when created', async () => {
    const db = await fresh();
    expect((await db.meta.get('schemaVersion'))?.value).toBe(SCHEMA_VERSION);
  });

  it('enforces one record per identity', async () => {
    const db = await fresh();
    await db.words.add(makeWord('a', 'Apfel', 'der', 'elma'));
    await expect(db.words.add(makeWord('b', 'Apfel', 'der', 'elma'))).rejects.toMatchObject({ name: 'ConstraintError' });
  });

  it('stores morgen and der Morgen as separate words', async () => {
    const db = await fresh();
    await db.words.bulkAdd([makeWord('a', 'morgen', null, 'yarın'), makeWord('b', 'Morgen', 'der', 'sabah')]);
    expect(await db.words.count()).toBe(2);
  });

  it('allows one card per word and track', async () => {
    const db = await fresh();
    await db.cards.add(makeCard('a', 'de_tr'));
    await db.cards.add(makeCard('a', 'tr_de'));
    await expect(db.cards.add(makeCard('a', 'de_tr'))).rejects.toMatchObject({ name: 'ConstraintError' });
  });

  it('finds favorites and due cards through indexes', async () => {
    const db = await fresh();
    await db.words.bulkAdd([{ ...makeWord('a', 'Apfel', 'der', 'elma'), favoritedAt: T0 }, makeWord('b', 'Buch', 'das', 'kitap')]);
    expect((await db.words.where('favoritedAt').above(0).toArray()).map((w) => w.id)).toEqual(['a']);
    await db.cards.bulkAdd([makeCard('a', 'de_tr', T0), makeCard('b', 'de_tr', T0 + 10)]);
    expect(await db.cards.where('due').belowOrEqual(T0).count()).toBe(1);
  });

  it('keeps a word in several groups as one record', async () => {
    const db = await fresh();
    await seedLibrary(db);
    expect(await db.groupMembers.where('wordId').equals('w-apfel').count()).toBe(2);
    expect(await db.words.where('identityKey').equals('Apfel|der').count()).toBe(1);
  });
});

describe('atomic writes', () => {
  it('saves the schedule and its log together, with the previous state', async () => {
    const db = await fresh();
    await withCard(db);
    const next = await applyGrade(makeFsrs(T0), 'good', T0);
    expect(await saveReview(db, answer)).toEqual({ status: 'saved', next });
    const card = await db.cards.get(['w-apfel', 'de_tr']);
    expect(card?.fsrs).toEqual(next);
    expect(card?.due).toBe(next.dueAt);
    const [log] = await db.reviewLogs.toArray();
    expect(log).toMatchObject({ mode: 'scheduled', grade: 'good', prevFsrs: makeFsrs(T0) });
  });

  it('rolls back the card when writing the log fails', async () => {
    const db = await fresh();
    await withCard(db);
    const failing = () => {
      throw new Error('log write failed');
    };
    db.reviewLogs.hook('creating', failing);
    await expect(saveReview(db, answer)).rejects.toThrow('log write failed');
    db.reviewLogs.hook('creating').unsubscribe(failing);
    expect((await db.cards.get(['w-apfel', 'de_tr']))?.due).toBe(T0);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('rolls back the log when writing the card fails', async () => {
    const db = await fresh();
    await withCard(db);
    const failing = () => {
      throw new Error('card write failed');
    };
    db.cards.hook('creating', failing);
    db.cards.hook('updating', failing);
    await expect(saveReview(db, answer)).rejects.toThrow('card write failed');
    db.cards.hook('creating').unsubscribe(failing);
    db.cards.hook('updating').unsubscribe(failing);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('refuses an answer for a card that does not exist', async () => {
    const db = await fresh();
    await db.words.add(apfel);
    expect(await saveReview(db, answer)).toEqual({ status: 'conflict' });
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('adds nothing when one row of a bulk write fails', async () => {
    const db = await fresh();
    await db.words.add(makeWord('a', 'Apfel', 'der', 'elma'));
    await expect(
      db.transaction('rw', db.words, async () => {
        await db.words.bulkAdd([makeWord('b', 'Buch', 'das', 'kitap'), makeWord('c', 'Apfel', 'der', 'elma')]);
      }),
    ).rejects.toBeTruthy();
    expect(await db.words.count()).toBe(1);
  });
});

describe('Free Practice isolation', () => {
  it('logs an attempt and changes no scheduled state', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const before = await db.cards.toArray();
    await recordPracticeAttempt(db, { wordId: 'w-apfel', track: 'de_tr', at: T0 + 5, typed: 'yanlış', result: 'wrong', hintsUsed: 1 });
    expect(await db.cards.toArray()).toEqual(before);
    const last = await db.reviewLogs.orderBy('seq').last();
    expect(last).toMatchObject({ mode: 'practice', result: 'wrong', hintsUsed: 1 });
    expect(last).not.toHaveProperty('grade');
    expect(last).not.toHaveProperty('prevFsrs');
  });

  it('works for a word with no card and does not create one', async () => {
    const db = await fresh();
    await recordPracticeAttempt(db, { wordId: 'new-word', track: 'tr_de', at: T0, typed: 'x', result: 'wrong', hintsUsed: 0 });
    expect(await db.cards.count()).toBe(0);
  });
});

describe('schema safety', () => {
  const v2: Migration = {
    version: 2,
    stores: { notes: '&id' },
    upgrade: (tx) =>
      tx
        .table('words')
        .toCollection()
        .modify((word: Record<string, unknown>) => {
          word.migrated = true;
        }) as unknown as Promise<void>,
  };
  const failing: Migration = {
    version: 3,
    stores: { extra: '&id' },
    upgrade: async (tx) => {
      await tx
        .table('words')
        .toCollection()
        .modify((word: Record<string, unknown>) => {
          word.damaged = true;
        });
      throw new Error('migration bug');
    },
  };

  it('upgrades in place and keeps data', async () => {
    const name = uniqueDbName();
    const db1 = await openDatabase({ name });
    await db1.words.add(makeWord('a', 'Fuß', 'der', 'ayak'));
    db1.close();
    const db2 = await openDatabase({ name, migrations: [...MIGRATIONS, v2] });
    expect(await db2.words.get('a')).toMatchObject({ lemma: 'Fuß', migrated: true });
    expect((await db2.meta.get('schemaVersion'))?.value).toBe(2);
    db2.close();
  });

  it('rolls a failed migration back and reports it', async () => {
    const name = uniqueDbName();
    const db1 = await openDatabase({ name, migrations: [...MIGRATIONS, v2] });
    await db1.words.add(makeWord('a', 'Fuß', 'der', 'ayak'));
    db1.close();
    await expect(openDatabase({ name, migrations: [...MIGRATIONS, v2, failing] })).rejects.toBeInstanceOf(MigrationFailedError);
    const db2 = await openDatabase({ name, migrations: [...MIGRATIONS, v2] });
    const word = await db2.words.get('a');
    expect(word?.lemma).toBe('Fuß');
    expect(word).not.toHaveProperty('damaged');
    db2.close();
  });

  it('refuses a database from a newer app version and leaves it unchanged', async () => {
    const name = uniqueDbName();
    const newer = await openDatabase({ name, migrations: [...MIGRATIONS, v2] });
    await newer.words.add(makeWord('a', 'Fuß', 'der', 'ayak'));
    newer.close();

    const error = await openDatabase({ name }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NewerSchemaError);
    expect(error).toMatchObject({ storedVersion: 2, appVersion: 1 });

    const again = await openDatabase({ name, migrations: [...MIGRATIONS, v2] });
    expect(again.verno).toBe(2);
    expect(await again.words.count()).toBe(1);
    expect((await again.meta.get('schemaVersion'))?.value).toBe(2);
    again.close();
  });

  it('closes and notifies an open connection when another tab upgrades', async () => {
    const name = uniqueDbName();
    let closed = false;
    const first = await openDatabase({ name, onClosedByUpgrade: () => (closed = true) });
    const second = await openDatabase({ name, migrations: [...MIGRATIONS, v2] });
    expect(closed).toBe(true);
    expect(first.isOpen()).toBe(false);
    second.close();
  });

  it('uses Dexie version numbering the check depends on', async () => {
    const name = uniqueDbName();
    const db = await openDatabase({ name });
    expect(db.backendDB().version).toBe(SCHEMA_VERSION * 10);
    db.close();
    await Dexie.delete(name);
  });
});

describe('backup reminder', () => {
  const DAY = 86_400_000;
  it('stays quiet with nothing to lose', () => expect(isBackupDue(0, null, T0)).toBe(false));
  it('asks when there are words and no backup', () => expect(isBackupDue(1, null, T0)).toBe(true));
  it('asks after 7 days', () => {
    expect(isBackupDue(1, T0, T0 + 6 * DAY)).toBe(false);
    expect(isBackupDue(1, T0, T0 + 7 * DAY)).toBe(true);
  });
});

describe('reading the library for the interface', () => {
  it('lists active words alphabetically and hides deleted ones', async () => {
    const db = await openDatabase({ name: uniqueDbName() });
    await seedLibrary(db);
    await db.words.update('w-spinat', { deletedAt: T0 });
    expect((await listActiveWords(db)).map((w) => w.id)).toEqual(['w-apfel', 'w-fuss', 'w-morgen', 'w-morgen-noun']);
    expect(await getActiveWord(db, 'w-spinat')).toBeNull();
    expect((await getActiveWord(db, 'w-apfel'))?.lemma).toBe('Apfel');
    db.close();
  });

  it('counts and opens collections without deleted words', async () => {
    const db = await openDatabase({ name: uniqueDbName() });
    await seedLibrary(db);
    await db.groupMembers.add({ groupId: 'g-custom', wordId: 'w-spinat', addedAt: T0, importRowId: null });
    await db.words.update('w-spinat', { deletedAt: T0 });
    expect((await listGroupSummaries(db)).map((s) => [s.group.id, s.wordCount])).toEqual([['g-pdf', 1], ['g-custom', 1]]);
    expect((await getGroupWithWords(db, 'g-custom'))?.words.map((w) => w.id)).toEqual(['w-apfel']);
    expect(await getGroupWithWords(db, 'missing')).toBeNull();
    expect((await listGroupsOfWord(db, 'w-apfel')).map((g) => g.id)).toEqual(['g-pdf', 'g-custom']);
    db.close();
  });
});
