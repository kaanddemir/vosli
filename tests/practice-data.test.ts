import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createValidator } from '../src/core/validation';
import { dismissalKey } from '../src/core/issues';
import { createBackup, exportBackupText, parseBackup, restoreBackup } from '../src/data/backup';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { addDismissals } from '../src/data/dismissals';
import { loadPracticeData } from '../src/data/practice';
import { recordPracticeAttempt } from '../src/data/repository';
import { deleteWord } from '../src/data/words';
import { realDictionary } from './support/dictionary';
import { makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

let db: AppDatabase;
beforeEach(async () => {
  db = await openDatabase({ name: uniqueDbName() });
  await seedLibrary(db);
});
afterEach(() => db.close());

const attempt = { wordId: 'w-apfel', track: 'tr_de' as const, at: T0 + 10, typed: 'der Apfel', result: 'correct' as const, hintsUsed: 0, sessionId: 'sess' };

describe('practice history', () => {
  it('saves first attempts and retries apart, in the existing table, with no scheduling fields', async () => {
    await recordPracticeAttempt(db, attempt);
    await recordPracticeAttempt(db, { ...attempt, at: T0 + 20, retry: true, hintsUsed: 1 });
    const logs = (await db.reviewLogs.toArray()).slice(-2);
    expect(logs[0]).toMatchObject({ mode: 'practice', sessionId: 'sess' });
    expect(logs[0]).not.toHaveProperty('retry');
    expect(logs[1]).toMatchObject({ mode: 'practice', retry: true, hintsUsed: 1 });
    for (const log of logs) {
      expect(log).not.toHaveProperty('grade');
      expect(log).not.toHaveProperty('prevFsrs');
    }
  });

  it('leaves every card, word and membership exactly as it was', async () => {
    const before = await createBackup(db, T0);
    for (let i = 0; i < 25; i++) await recordPracticeAttempt(db, { ...attempt, wordId: 'w-fuss', at: T0 + i, result: i % 2 ? 'wrong' : 'correct', hintsUsed: i % 3 === 0 ? 1 : 0, ...(i % 2 ? { retry: true } : {}) });
    const after = await createBackup(db, T0);
    for (const table of ['cards', 'words', 'groups', 'groupMembers', 'sources', 'importRows'] as const) expect(after.tables[table]).toEqual(before.tables[table]);
    expect(after.tables.reviewLogs).toHaveLength(before.tables.reviewLogs.length + 25);
  });

  it('new fields pass a backup and restore unchanged', async () => {
    await recordPracticeAttempt(db, { ...attempt, retry: true });
    const parsed = parseBackup(await exportBackupText(db, T0));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const target = await openDatabase({ name: uniqueDbName() });
    await restoreBackup(target, parsed.backup);
    expect((await target.reviewLogs.toArray()).at(-1)).toMatchObject({ mode: 'practice', retry: true, sessionId: 'sess' });
    target.close();
  });

  it('older backups, whose practice logs have neither field, are still accepted', async () => {
    const backup = await createBackup(db, T0);
    const practice = backup.tables.reviewLogs.find((row) => row.mode === 'practice')!;
    expect(practice).not.toHaveProperty('sessionId');
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
  });

  it('refuses a damaged retry or session field', async () => {
    for (const bad of [{ retry: 'yes' }, { sessionId: 4 }]) {
      const backup = await createBackup(db, T0);
      Object.assign(backup.tables.reviewLogs.find((row) => row.mode === 'practice')!, bad);
      expect(parseBackup(JSON.stringify(backup)).ok).toBe(false);
    }
  });
});

describe('practice data', () => {
  it('holds active words only, and difficulty comes from the history', async () => {
    await recordPracticeAttempt(db, { ...attempt, wordId: 'w-fuss', result: 'wrong' });
    await deleteWord(db, 'w-spinat');
    const data = await loadPracticeData(db, null);
    expect(data.words.map((word) => word.id)).not.toContain('w-spinat');
    expect(data.difficult.has('w-fuss')).toBe(true);
  });

  it('without a dictionary nothing is flagged and nothing is held back', async () => {
    const data = await loadPracticeData(db, null);
    expect(data.flagged.size).toBe(0);
  });

  describe('with the real dictionary', () => {
    const validate = () => createValidator(realDictionary());
    const add = async () => {
      await db.words.bulkAdd([makeWord('w-automat', 'Geldautomat', 'das', 'bankamatik'), makeWord('w-hund', 'Hund', 'der', 'köpek'), makeWord('w-yok', 'Xyzzyquark', 'der', 'yok'), makeWord('w-lampe', 'Lampe', null, 'lamba')]);
    };

    it('flags a real article mismatch, and a word it does not know or one missing an article stays usable', async () => {
      await add();
      const { flagged } = await loadPracticeData(db, validate());
      expect(flagged.get('w-automat')?.map((item) => item.code)).toEqual(['article_wrong']);
      for (const id of ['w-hund', 'w-yok', 'w-lampe']) expect(flagged.has(id)).toBe(false);
    });

    it('respects a warning the person already accepted', async () => {
      await add();
      await addDismissals(db, [dismissalKey('article_wrong', 'Geldautomat', 'das')]);
      const { flagged } = await loadPracticeData(db, validate());
      expect(flagged.has('w-automat')).toBe(false);
    });

    it('never changes the word it flagged', async () => {
      await add();
      const before = await db.words.get('w-automat');
      await loadPracticeData(db, validate());
      expect(await db.words.get('w-automat')).toEqual(before);
    });
  });
});
