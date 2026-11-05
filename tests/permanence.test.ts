import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { affectedTracks, type WordText } from '../src/core/scheduling/invalidation';
import { createBackup, parseBackup, restoreBackup } from '../src/data/backup';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { recordPracticeAttempt } from '../src/data/repository';
import { saveReview } from '../src/data/smartReview';
import { deleteWord, deleteWords, purgeMarkedWords, updateWord, WordNotFoundError } from '../src/data/words';
import { withMeanings } from '../src/data/words';
import { makeCard, makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const text = (lemma: string, article: WordText['article'], ...meanings: string[]): WordText => ({ lemma, article, meanings: meanings.map((meaning) => ({ text: meaning })) });
const APFEL = text('Apfel', 'der', 'elma');

let db: AppDatabase;
beforeEach(async () => {
  db = await openDatabase({ name: uniqueDbName() });
  await seedLibrary(db);
});
afterEach(() => db.close());

describe('which schedules an edit makes worthless', () => {
  const cases: [string, WordText, WordText, string[]][] = [
    ['nothing changed', APFEL, APFEL, []],
    ['spacing in the German', APFEL, text('  Apfel ', 'der', 'elma'), []],
    ['closing punctuation', text('Was?', null, 'ne?'), text('Was', null, 'ne'), []],
    ['Turkish capitals', APFEL, text('Apfel', 'der', 'Elma'), []],
    ['a note added to a meaning', APFEL, text('Apfel', 'der', 'elma (meyve)'), []],
    ['another meaning added', APFEL, text('Apfel', 'der', 'elma', 'alma'), []],
    ['one meaning of two removed', text('Apfel', 'der', 'elma', 'alma'), APFEL, []],
    ['the first meaning of two removed', text('Apfel', 'der', 'alma', 'elma'), text('Apfel', 'der', 'elma'), []],
    ['one of two written with a slash removed', text('Apfel', 'der', 'elma/alma'), APFEL, []],
    ['one of two replaced by a new meaning', text('Apfel', 'der', 'elma', 'alma'), text('Apfel', 'der', 'elma', 'armut'), []],
    ['an alternative spelling added', text('Foto', 'das', 'fotoğraf'), text('Foto/Photo', 'das', 'fotoğraf'), []],
    ['a German spelling correction', text('Fus', 'der', 'ayak'), text('Fuß', 'der', 'ayak'), ['tr_de']],
    ['an umlaut', text('Tur', 'die', 'kapı'), text('Tür', 'die', 'kapı'), ['tr_de']],
    ['a capital, which German spelling counts', text('morgen', null, 'yarın'), text('Morgen', null, 'yarın'), ['tr_de']],
    ['every meaning replaced', APFEL, text('Apfel', 'der', 'armut'), ['tr_de', 'de_tr']],
    ['article changed', APFEL, text('Apfel', 'die', 'elma'), ['tr_de', 'article']],
    ['article added', text('Lampe', null, 'lamba'), text('Lampe', 'die', 'lamba'), ['tr_de', 'article']],
    ['article removed', APFEL, text('Apfel', null, 'elma'), ['tr_de', 'article']],
    ['German and Turkish both: a different word', APFEL, text('Tisch', 'der', 'masa'), ['tr_de', 'de_tr', 'article']],
  ];
  for (const [name, before, after, tracks] of cases) {
    it(name, () => expect(affectedTracks(before, after).sort()).toEqual([...tracks].sort()));
  }
});

describe('applying those rules', () => {
  const entry = (lemma: string, article: 'der' | 'die' | 'das' | null, ...meanings: string[]) => ({ lemma, article, meanings, plural: null });
  beforeEach(async () => {
    await db.cards.clear();
    await db.cards.bulkAdd([makeCard('w-apfel', 'de_tr'), makeCard('w-apfel', 'tr_de'), makeCard('w-apfel', 'article')]);
  });
  const tracks = async () => (await db.cards.where('wordId').equals('w-apfel').toArray()).map((card) => card.track).sort();

  it('keeps every schedule and every log for a harmless edit', async () => {
    const [cards, logs] = [await db.cards.toArray(), await db.reviewLogs.toArray()];
    await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'Elma', 'alma'), T0);
    expect(await db.cards.toArray()).toEqual(cards);
    expect(await db.reviewLogs.toArray()).toEqual(logs);
  });

  it('removes only the affected schedules, keeps the logs, and touches no other word', async () => {
    await db.cards.add(makeCard('w-fuss', 'tr_de'));
    const logs = await db.reviewLogs.toArray();
    await updateWord(db, 'w-apfel', entry('Äpfel', 'der', 'elma'), T0);
    expect(await tracks()).toEqual(['article', 'de_tr']);
    expect(await db.reviewLogs.toArray()).toEqual(logs);
    expect(await db.cards.get(['w-fuss', 'tr_de'])).toBeDefined();
  });

  it('removing one meaning keeps every schedule and log exactly', async () => {
    await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'elma', 'alma'), T0);
    const [cards, logs] = [await db.cards.toArray(), await db.reviewLogs.toArray()];
    await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'alma'), T0);
    expect((await db.words.get('w-apfel'))?.meanings.map((meaning) => meaning.text)).toEqual(['alma']);
    expect(await db.cards.toArray()).toEqual(cards);
    expect(await db.reviewLogs.toArray()).toEqual(logs);
  });

  it('replacing every meaning resets only the two language skills, and keeps article and logs', async () => {
    const article = await db.cards.get(['w-apfel', 'article']);
    const logs = await db.reviewLogs.toArray();
    await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'armut'), T0);
    expect(await tracks()).toEqual(['article']);
    expect(await db.cards.get(['w-apfel', 'article'])).toEqual(article);
    expect(await db.reviewLogs.toArray()).toEqual(logs);
  });

  it('an added meaning from an import keeps every schedule', async () => {
    const word = (await db.words.get('w-apfel'))!;
    const before = await db.cards.toArray();
    await db.words.put(withMeanings(word, ['alma'], T0));
    expect(await db.cards.toArray()).toEqual(before);
  });

  it('a failed edit keeps both the word and the schedules', async () => {
    const failing = () => {
      throw new Error('boom');
    };
    db.cards.hook('deleting', failing);
    await expect(updateWord(db, 'w-apfel', entry('Apfel', 'die', 'armut'), T0)).rejects.toThrow();
    db.cards.hook('deleting').unsubscribe(failing);
    expect(await tracks()).toEqual(['article', 'de_tr', 'tr_de']);
    expect((await db.words.get('w-apfel'))?.article).toBe('der');
  });
});

describe('permanent deletion', () => {
  const snapshot = async () => {
    const backup = await createBackup(db, T0);
    return backup.tables;
  };

  it('leaves no reference to the word in any table', async () => {
    await deleteWord(db, 'w-apfel');
    const tables = await snapshot();
    expect(JSON.stringify(tables)).not.toContain('w-apfel');
  });

  it('leaves everything unrelated exactly as it was', async () => {
    const before = await snapshot();
    await deleteWord(db, 'w-apfel');
    const after = await snapshot();
    const without = (rows: Record<string, unknown>[]) => rows.filter((row) => row.wordId !== 'w-apfel' && row.id !== 'w-apfel');
    for (const table of ['words', 'cards', 'reviewLogs', 'groupMembers', 'importRows'] as const) expect(after[table]).toEqual(without(before[table]));
    expect(after.groups).toEqual(before.groups);
    expect(after.sources).toEqual(before.sources);
    expect(after.meta).toEqual(before.meta);
  });

  it('a backup taken after it is valid, so nothing is left broken', async () => {
    await deleteWord(db, 'w-apfel');
    expect(parseBackup(JSON.stringify(await createBackup(db, T0))).ok).toBe(true);
  });

  it('deleting several removes each with everything of theirs, and leaves collections, sources and other words', async () => {
    const before = await snapshot();
    await deleteWords(db, ['w-apfel', 'w-spinat', 'already-gone']);
    const after = await snapshot();
    const gone = (row: { wordId?: string | null; id?: unknown }) => row.wordId === 'w-apfel' || row.wordId === 'w-spinat' || row.id === 'w-apfel' || row.id === 'w-spinat';
    for (const table of ['words', 'cards', 'reviewLogs', 'groupMembers', 'importRows'] as const) expect(after[table]).toEqual((before[table] as { wordId?: string | null; id?: unknown }[]).filter((row) => !gone(row)));
    expect(after.groups).toEqual(before.groups);
    expect(after.sources).toEqual(before.sources);
  });

  it('deleting several is all or nothing, even when the last word fails', async () => {
    const before = await snapshot();
    const failing = (key: string) => {
      if (key === 'w-spinat') throw new Error('boom');
    };
    db.words.hook('deleting', failing);
    await expect(deleteWords(db, ['w-apfel', 'w-spinat'])).rejects.toThrow('boom');
    db.words.hook('deleting').unsubscribe(failing);
    expect(await snapshot()).toEqual(before);
  });

  it('is all or nothing', async () => {
    const before = await snapshot();
    const failing = () => {
      throw new Error('boom');
    };
    db.importRows.hook('deleting', failing);
    await expect(deleteWord(db, 'w-apfel')).rejects.toThrow();
    db.importRows.hook('deleting').unsubscribe(failing);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses a word that is not there, and a second delete changes nothing', async () => {
    await deleteWord(db, 'w-apfel');
    const before = await snapshot();
    await expect(deleteWord(db, 'w-apfel')).rejects.toBeInstanceOf(WordNotFoundError);
    expect(await snapshot()).toEqual(before);
  });

  it('a late answer from a session leaves no record of a word now gone', async () => {
    const word = (await db.words.get('w-spinat'))!;
    await deleteWord(db, 'w-spinat');
    await recordPracticeAttempt(db, { wordId: 'w-spinat', track: 'tr_de', at: T0, typed: 'x', result: 'wrong', hintsUsed: 0 });
    const result = await saveReview(db, { word, track: 'de_tr', expected: null, typed: 'x', result: 'wrong', correct: false, hinted: false, at: T0, sessionId: 's', retry: false });
    expect(result.status).toBe('conflict');
    expect(await db.reviewLogs.where('wordId').equals('w-spinat').count()).toBe(0);
    expect(await db.cards.where('wordId').equals('w-spinat').count()).toBe(0);
  });

  it('restoring a backup taken before the delete brings the word back, as a backup should', async () => {
    const backup = await createBackup(db, T0);
    await deleteWord(db, 'w-apfel');
    await restoreBackup(db, backup);
    expect(await db.words.get('w-apfel')).toBeDefined();
    expect(await db.cards.where('wordId').equals('w-apfel').count()).toBeGreaterThan(0);
  });
});

describe('words marked deleted by earlier versions', () => {
  it('are removed with their data when the database opens', async () => {
    await db.words.update('w-apfel', { deletedAt: T0 });
    const name = db.name;
    db.close();
    db = await openDatabase({ name });
    expect(await db.words.get('w-apfel')).toBeUndefined();
    expect(await db.reviewLogs.where('wordId').equals('w-apfel').count()).toBe(0);
    expect(await db.cards.where('wordId').equals('w-apfel').count()).toBe(0);
    expect(await db.words.count()).toBe(4);
  });

  it('an older backup holding one stays readable, and the word stays deleted', async () => {
    const backup = await createBackup(db, T0);
    const apfel = backup.tables.words.find((row) => row.id === 'w-apfel')!;
    apfel.deletedAt = T0;
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const target = await openDatabase({ name: uniqueDbName() });
    await restoreBackup(target, parsed.backup);
    expect(await target.words.get('w-apfel')).toBeUndefined();
    expect(await target.words.count()).toBe(4);
    expect(await target.reviewLogs.where('wordId').equals('w-apfel').count()).toBe(0);
    target.close();
  });

  it('running it again finds nothing', async () => {
    await db.words.add(makeWord('w-gone', 'Weg', 'der', 'yol'));
    await db.words.update('w-gone', { deletedAt: T0 });
    expect(await purgeMarkedWords(db)).toBe(1);
    expect(await purgeMarkedWords(db)).toBe(0);
  });
});
