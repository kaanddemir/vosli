import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dismissalKey } from '../src/core/issues';
import { batchFrom } from '../src/core/scheduling/queue';
import { createValidator, type Validate } from '../src/core/validation';
import { applyGrade, createFsrsState, phaseOf, SCHEDULER_VERSION, type FsrsState } from '../src/core/scheduling/fsrs';
import { createBackup, exportBackupText, parseBackup, restoreBackup } from '../src/data/backup';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { addDismissals } from '../src/data/dismissals';
import { addWordsToGroup, createCustomGroup, deleteGroups, removeWordFromGroup } from '../src/data/groups';
import { recordPracticeAttempt } from '../src/data/repository';
import { flaggedWaiting, loadReviewData, overviewOf, planFrom, readCardState, saveReview, type ReviewAnswer } from '../src/data/smartReview';
import type { Track, Word } from '../src/data/types';
import { addWord, deleteWord, updateWord } from '../src/data/words';
import { realDictionary } from './support/dictionary';
import { makeWord, T0, uniqueDbName } from './support/fixtures';

/** What can be asked now, which is what offers the way on after a session. */
const available = async (database: AppDatabase, now: number) => {
  const plan = planFrom(await loadReviewData(database, null), false, now);
  return { plan, count: plan.due.length + plan.fresh.length };
};

/** What Home reads. */
const readOverview = async (db: AppDatabase, validate: Validate | null, now: number) => overviewOf(await loadReviewData(db, validate), now);

const MIN = 60_000;
const DAY = 86_400_000;

let db: AppDatabase;
let apfel: Word;
beforeEach(async () => {
  db = await openDatabase({ name: uniqueDbName() });
  apfel = makeWord('w-apfel', 'Apfel', 'der', 'elma');
  await db.words.add(apfel);
});
afterEach(() => db.close());

const answer = (over: Partial<ReviewAnswer> = {}): ReviewAnswer => ({ word: apfel, track: 'de_tr', expected: null, typed: 'elma', result: 'correct', correct: true, hinted: false, at: T0, sessionId: 's', retry: false, ...over });
const stateOf = async (track: Track = 'de_tr', wordId = 'w-apfel') => (await db.cards.get([wordId, track]))?.fsrs ?? null;
const entry = (lemma: string, article: 'der' | 'die' | 'das' | null, ...meanings: string[]) => ({ lemma, article, meanings, plural: null });

/** Answers until the card is a review card, the way a session would. */
async function graduate(track: Track = 'de_tr', word: Word = apfel) {
  let now = T0;
  for (const expected of [null, 'stored'] as const) {
    const stored = expected === null ? null : await stateOf(track, word.id);
    const saved = await saveReview(db, answer({ word, track, expected: stored, at: now }));
    if (saved.status !== 'saved') throw new Error('not saved');
    now = saved.next.dueAt;
  }
  return now;
}

describe('scheduling an answer', () => {
  it('a first answer creates the card and its history entry together', async () => {
    const result = await saveReview(db, answer());
    expect(result.status).toBe('saved');
    const card = await db.cards.get(['w-apfel', 'de_tr']);
    expect(card).toMatchObject({ wordId: 'w-apfel', track: 'de_tr', schedulerVersion: SCHEDULER_VERSION });
    expect(card!.due).toBe(card!.fsrs.dueAt);
    expect(card!.due).toBe(T0 + 10 * MIN);
    const [log] = await db.reviewLogs.toArray();
    expect(log).toMatchObject({ mode: 'scheduled', grade: 'good', hintsUsed: 0, sessionId: 's', wordId: 'w-apfel', track: 'de_tr' });
    expect(log).not.toHaveProperty('retry');
    expect(log!.mode === 'scheduled' && log!.prevFsrs.reps).toBe(0);
  });

  it('turns a wrong answer into Again, and a hinted one into Hard', async () => {
    await saveReview(db, answer({ correct: false, result: 'wrong', hinted: true }));
    await saveReview(db, answer({ track: 'tr_de', hinted: true }));
    const logs = await db.reviewLogs.toArray();
    expect(logs.map((log) => log.mode === 'scheduled' && log.grade)).toEqual(['again', 'hard']);
    expect(logs[0]!.hintsUsed).toBe(1);
    expect((await stateOf('de_tr'))!.dueAt).toBe(T0 + MIN);
    expect((await stateOf('tr_de'))!.dueAt).toBe(T0 + 5.5 * MIN);
  });

  it('only touches the skill answered', async () => {
    await saveReview(db, answer());
    expect(await stateOf('tr_de')).toBeNull();
    expect(await stateOf('article')).toBeNull();
    expect(await db.cards.count()).toBe(1);
  });

  it('marks a repeat in the history, so Free Practice does not read it as fresh evidence', async () => {
    await saveReview(db, answer());
    await saveReview(db, answer({ expected: await stateOf(), at: T0 + 10 * MIN, retry: true }));
    expect((await db.reviewLogs.toArray())[1]).toMatchObject({ retry: true });
  });

  it('rolls both back if the history entry fails', async () => {
    const failing = () => {
      throw new Error('boom');
    };
    db.reviewLogs.hook('creating', failing);
    await expect(saveReview(db, answer())).rejects.toThrow();
    db.reviewLogs.hook('creating').unsubscribe(failing);
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('rolls both back if the card fails', async () => {
    await saveReview(db, answer());
    const before = await stateOf();
    const failing = () => {
      throw new Error('boom');
    };
    db.cards.hook('updating', failing);
    await expect(saveReview(db, answer({ expected: before, at: T0 + 10 * MIN }))).rejects.toThrow();
    db.cards.hook('updating').unsubscribe(failing);
    expect(await stateOf()).toEqual(before);
    expect(await db.reviewLogs.count()).toBe(1);
  });
});

describe('answers that arrive twice or late', () => {
  it('two presses of one answer schedule it once', async () => {
    const results = await Promise.all([saveReview(db, answer()), saveReview(db, answer())]);
    expect(results.map((result) => result.status).sort()).toEqual(['conflict', 'saved']);
    expect(await db.reviewLogs.count()).toBe(1);
    expect((await stateOf())!.reps).toBe(1);
  });

  it('a whole burst on a review card still schedules once', async () => {
    const end = await graduate();
    const expected = await stateOf();
    const results = await Promise.all(Array.from({ length: 5 }, () => saveReview(db, answer({ expected, at: end }))));
    expect(results.filter((result) => result.status === 'saved')).toHaveLength(1);
    expect(await db.reviewLogs.count()).toBe(3);
  });

  it('a second tab with the old state cannot overwrite a newer schedule', async () => {
    const end = await graduate();
    const old = await stateOf();
    await saveReview(db, answer({ expected: old, at: end, correct: true }));
    const newer = await stateOf();
    const late = await saveReview(db, answer({ expected: old, at: end + 1, correct: false, result: 'wrong' }));
    expect(late.status).toBe('conflict');
    expect(await stateOf()).toEqual(newer);
    expect(await db.reviewLogs.count()).toBe(3);
  });

  it('two real connections, as two tabs have, do not lose or double an answer', async () => {
    const other = await openDatabase({ name: db.name });
    const results = await Promise.all([saveReview(db, answer()), saveReview(other, answer())]);
    expect(results.map((result) => result.status).sort()).toEqual(['conflict', 'saved']);
    expect(await db.reviewLogs.count()).toBe(1);
    other.close();
  });

  it('an answer for a word deleted in the meantime is not scheduled', async () => {
    await deleteWord(db, 'w-apfel');
    expect((await saveReview(db, answer())).status).toBe('conflict');
    expect(await db.cards.count()).toBe(0);
  });

  it('an answer to a question whose text has since changed is not scheduled', async () => {
    for (const change of [entry('Apfel', 'die', 'elma'), entry('Äpfel', 'der', 'elma'), entry('Apfel', 'der', 'alma')]) {
      await updateWord(db, 'w-apfel', change, T0);
      expect((await saveReview(db, answer())).status).toBe('conflict');
      await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'elma'), T0);
    }
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('a change that does not affect the question, such as a favorite, does not block the answer', async () => {
    await db.words.update('w-apfel', { favoritedAt: T0, updatedAt: T0 + 1 });
    expect((await saveReview(db, answer())).status).toBe('saved');
  });
});

describe('free practice stays out of schedules', () => {
  it('leaves every card byte for byte as it was, however many attempts, right or wrong', async () => {
    await graduate();
    const before = await db.cards.toArray();
    for (let i = 0; i < 30; i++) await recordPracticeAttempt(db, { wordId: 'w-apfel', track: 'de_tr', at: T0 + i, typed: 'x', result: i % 2 ? 'wrong' : 'correct', hintsUsed: i % 3 ? 1 : 0, sessionId: 'p' });
    expect(await db.cards.toArray()).toEqual(before);
    const logs = await db.reviewLogs.toArray();
    expect(logs.filter((log) => log.mode === 'scheduled')).toHaveLength(2);
    expect(logs.filter((log) => log.mode === 'practice')).toHaveLength(30);
  });

  it('a practice attempt creates no card for a word never reviewed', async () => {
    await recordPracticeAttempt(db, { wordId: 'w-apfel', track: 'tr_de', at: T0, typed: 'der Apfel', result: 'correct', hintsUsed: 0 });
    expect(await db.cards.count()).toBe(0);
    const data = await loadReviewData(db, null);
    expect(planFrom(data, false, T0).fresh).toHaveLength(1);
  });

  it('a practice attempt on a due card does not make it any less due', async () => {
    const end = await graduate();
    await recordPracticeAttempt(db, { wordId: 'w-apfel', track: 'de_tr', at: end, typed: 'elma', result: 'correct', hintsUsed: 0 });
    expect(planFrom(await loadReviewData(db, null), false, end).due).toHaveLength(1);
  });
});

describe('article changes', () => {
  it('a changed article resets the skills whose answer it is part of, and keeps meaning recognition', async () => {
    await graduate('article');
    await graduate('de_tr');
    await graduate('tr_de');
    const [de, logs] = [await stateOf('de_tr'), await db.reviewLogs.count()];
    await updateWord(db, 'w-apfel', entry('Apfel', 'die', 'elma'), T0);
    expect(await stateOf('article')).toBeNull();
    expect(await stateOf('tr_de')).toBeNull();
    expect(await stateOf('de_tr')).toEqual(de);
    expect(await db.reviewLogs.count()).toBe(logs);
    // Once the kept skill is not due, the reset ones come back as new, one at a time.
    const plan = planFrom(await loadReviewData(db, null), false, T0 + 11 * MIN);
    expect(plan.due).toEqual([]);
    expect(plan.fresh.map((item) => item.track)).toEqual(['tr_de']);
  });

  it('a removed article takes the card out of the queue and keeps the other skills', async () => {
    const end = await graduate('article');
    await graduate('de_tr');
    const de = await stateOf('de_tr');
    await updateWord(db, 'w-apfel', entry('Apfel', null, 'elma'), T0);
    expect(await stateOf('article')).toBeNull();
    expect(await stateOf('de_tr')).toEqual(de);
    const plan = planFrom(await loadReviewData(db, null), false, end + 365 * DAY);
    expect([...plan.due, ...plan.fresh].some((item) => item.track === 'article')).toBe(false);
  });

  it('an added article makes the skill available, with nothing carried over', async () => {
    const lampe = makeWord('w-lampe', 'Lampe', null, 'lamba');
    await db.words.add(lampe);
    await graduate('de_tr', lampe);
    await graduate('tr_de', lampe);
    expect((await readCardState(db, 'w-lampe', 'article')).card).toBeNull();
    const de = await stateOf('de_tr', 'w-lampe');
    await updateWord(db, 'w-lampe', entry('Lampe', 'die', 'lamba'), T0);
    // Writing Lampe alone is no longer a right answer, so that skill starts over too, before the article.
    expect(await stateOf('tr_de', 'w-lampe')).toBeNull();
    expect(await stateOf('de_tr', 'w-lampe')).toEqual(de);
    const later = planFrom(await loadReviewData(db, null), false, T0 + 11 * MIN).fresh.filter((item) => item.wordId === 'w-lampe');
    expect(later.map((item) => item.track)).toEqual(['tr_de']);
  });

  it('removing an article and putting it back does not bring the old schedule back', async () => {
    await graduate('article');
    await updateWord(db, 'w-apfel', entry('Apfel', null, 'elma'), T0);
    await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'elma'), T0);
    expect(await stateOf('article')).toBeNull();
  });

  it('an edit that leaves the article alone changes no schedule', async () => {
    await graduate('article');
    const before = await db.cards.toArray();
    await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'elma', 'alma'), T0);
    expect(await db.cards.toArray()).toEqual(before);
  });

  it('the card and the word change together: a failed edit keeps the card', async () => {
    await graduate('article');
    const before = await stateOf('article');
    const failing = () => {
      throw new Error('boom');
    };
    db.cards.hook('deleting', failing);
    await expect(updateWord(db, 'w-apfel', entry('Apfel', 'die', 'elma'), T0)).rejects.toThrow();
    db.cards.hook('deleting').unsubscribe(failing);
    expect(await stateOf('article')).toEqual(before);
    expect((await db.words.get('w-apfel'))!.article).toBe('der');
  });

  it('language cards survive a spelling fix, and the next review judges the new text', async () => {
    await graduate('tr_de');
    const before = await stateOf('tr_de');
    await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'elma'), T0);
    expect(await stateOf('tr_de')).toEqual(before);
  });
});

describe('deleted words', () => {
  it('a deleted word is not asked or counted, and nothing of it remains', async () => {
    const end = await graduate();
    await deleteWord(db, 'w-apfel');
    const plan = planFrom(await loadReviewData(db, null), false, end);
    expect(plan).toEqual({ due: [], fresh: [] });
    expect(await readOverview(db, null, end)).toMatchObject({ words: 0, due: 0, fresh: 0, studied: false });
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('adding it again starts from nothing', async () => {
    const end = await graduate();
    await deleteWord(db, 'w-apfel');
    const outcome = await addWord(db, entry('Apfel', 'der', 'elma'), null, [], end);
    if (outcome.kind !== 'saved') throw new Error('not saved');
    expect(outcome.word.id).not.toBe('w-apfel');
    const plan = planFrom(await loadReviewData(db, null), false, end);
    expect(plan.due).toEqual([]);
    expect(plan.fresh).toMatchObject([{ wordId: outcome.word.id, track: 'de_tr', kind: 'new' }]);
  });
});

describe('collections', () => {
  it('moving a word between collections changes nothing about its cards, and makes none', async () => {
    await graduate();
    const before = await db.cards.toArray();
    const one = await createCustomGroup(db, 'Bir', T0);
    const two = await createCustomGroup(db, 'İki', T0);
    await addWordsToGroup(db, one.id, ['w-apfel'], T0);
    await addWordsToGroup(db, two.id, ['w-apfel'], T0);
    expect(await db.cards.toArray()).toEqual(before);
    await removeWordFromGroup(db, one.id, 'w-apfel');
    await deleteGroups(db, [two.id]);
    expect(await db.cards.toArray()).toEqual(before);
  });
});

describe('home counts', () => {
  it('an empty library', async () => {
    await deleteWord(db, 'w-apfel');
    expect(await readOverview(db, null, T0)).toEqual({ words: 0, due: 0, fresh: 0, studied: false, flagged: 0 });
  });

  it('words nobody has studied are new, not due', async () => {
    expect(await readOverview(db, null, T0)).toEqual({ words: 1, due: 0, fresh: 1, studied: false, flagged: 0 });
  });

  it('a card waiting on a learning step is not due until its time, and blocks the next skill', async () => {
    await saveReview(db, answer());
    expect(await readOverview(db, null, T0 + MIN)).toMatchObject({ due: 0, fresh: 0, studied: true });
    expect(await readOverview(db, null, T0 + 10 * MIN)).toMatchObject({ due: 1, fresh: 0, studied: true });
  });

  it('counts each due skill, and only real cards of active words', async () => {
    const end = await graduate('de_tr');
    await graduate('tr_de');
    const fsrs: FsrsState = (await stateOf())!;
    await db.cards.add({ wordId: 'ghost', track: 'de_tr', due: fsrs.dueAt, fsrs, schedulerVersion: 'x' });
    expect((await readOverview(db, null, end + 5 * DAY)).due).toBe(2);
  });

  it('after everything is scheduled ahead there is nothing to do', async () => {
    await graduate('de_tr');
    await graduate('tr_de');
    await graduate('article');
    expect(await readOverview(db, null, T0 + 11 * MIN)).toMatchObject({ due: 0, fresh: 0, studied: true });
  });
});

describe('dictionary warnings', () => {
  const validate = () => createValidator(realDictionary());
  let flaggedWord: Word;
  beforeEach(async () => {
    flaggedWord = makeWord('w-automat', 'Geldautomat', 'das', 'bankamatik');
    await db.words.add(flaggedWord);
  });

  it('leaves a word with a real warning out unless included, and a word it does not know stays in', async () => {
    await db.words.add(makeWord('w-yok', 'Xyzzyquark', 'der', 'yok'));
    const data = await loadReviewData(db, validate());
    const ids = (include: boolean) => planFrom(data, include, T0).fresh.map((item) => item.wordId);
    expect(ids(false)).not.toContain('w-automat');
    expect(ids(false)).toContain('w-yok');
    expect(ids(true)).toContain('w-automat');
    expect(flaggedWaiting(data, T0).map((word) => word.id)).toEqual(['w-automat']);
  });

  it('home does not count a word left out, and says it is waiting', async () => {
    await deleteWord(db, 'w-apfel');
    expect(await readOverview(db, validate(), T0)).toMatchObject({ words: 1, fresh: 0, flagged: 1 });
  });

  it('a due card of a flagged word is held back too', async () => {
    await graduate('de_tr', flaggedWord);
    const data = await loadReviewData(db, validate());
    expect(planFrom(data, false, T0 + 5 * DAY).due.filter((item) => item.wordId === 'w-automat')).toEqual([]);
    expect(planFrom(data, true, T0 + 5 * DAY).due.filter((item) => item.wordId === 'w-automat')).toHaveLength(1);
  });

  it('even when included, a disputed article is never asked as a question', async () => {
    await graduate('article', flaggedWord);
    const data = await loadReviewData(db, validate());
    const plan = planFrom(data, true, T0 + 365 * DAY);
    expect([...plan.due, ...plan.fresh].filter((item) => item.wordId === 'w-automat' && item.track === 'article')).toEqual([]);
  });

  it('an accepted warning no longer holds anything back', async () => {
    await addDismissals(db, [dismissalKey('article_wrong', 'Geldautomat', 'das')]);
    const data = await loadReviewData(db, validate());
    expect(planFrom(data, false, T0).fresh.map((item) => item.wordId)).toContain('w-automat');
  });

  it('without a dictionary nothing is held back', async () => {
    const data = await loadReviewData(db, null);
    expect(planFrom(data, false, T0).fresh.map((item) => item.wordId)).toContain('w-automat');
  });
});

describe('backup and restore', () => {
  it('schedules survive exactly and continue exactly as they would have', async () => {
    const end = await graduate('de_tr');
    await saveReview(db, answer({ track: 'article', hinted: true }));
    const parsed = parseBackup(await exportBackupText(db, T0));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const target = await openDatabase({ name: uniqueDbName() });
    await restoreBackup(target, parsed.backup);
    expect(await target.cards.toArray()).toEqual(await db.cards.toArray());
    expect(await target.reviewLogs.toArray()).toEqual(await db.reviewLogs.toArray());
    const stored = (await target.cards.get(['w-apfel', 'de_tr']))!.fsrs;
    expect(await applyGrade(stored, 'good', end)).toEqual(await applyGrade((await stateOf())!, 'good', end));
    expect(await readOverview(target, null, end)).toEqual(await readOverview(db, null, end));
    target.close();
  });

  it('older backups, whose scheduled logs have no session or retry, are still accepted', async () => {
    await saveReview(db, answer());
    const backup = await createBackup(db, T0);
    delete backup.tables.reviewLogs[0]!.sessionId;
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
  });

  it('refuses a damaged session or retry on a scheduled log', async () => {
    await saveReview(db, answer());
    for (const bad of [{ sessionId: 4 }, { retry: 'yes' }]) {
      const backup = await createBackup(db, T0);
      Object.assign(backup.tables.reviewLogs[0]!, bad);
      expect(parseBackup(JSON.stringify(backup)).ok).toBe(false);
    }
  });

  it('the plan after a restore is the same as before', async () => {
    await graduate('de_tr');
    const parsed = parseBackup(await exportBackupText(db, T0));
    if (!parsed.ok) throw new Error('parse');
    const target = await openDatabase({ name: uniqueDbName() });
    await restoreBackup(target, parsed.backup);
    expect(planFrom(await loadReviewData(target, null), false, T0 + 5 * DAY)).toEqual(planFrom(await loadReviewData(db, null), false, T0 + 5 * DAY));
    target.close();
  });
});

it('a first card state is really new, so nothing about it looks studied', async () => {
  expect(phaseOf(await createFsrsState(T0))).toBe('new');
});

describe('another session can always follow', () => {
  it('there is no daily limit: new words keep coming until none are left, and only then nothing is offered', async () => {
    await db.words.bulkAdd(Array.from({ length: 44 }, (_, index) => makeWord(`w${index}`, `Wort${index}`, null, `anlam${index}`)));
    const sizes: number[] = [];
    for (;;) {
      const { plan, count } = await available(db, T0);
      if (count === 0) break;
      const batch = batchFrom(plan, () => 0);
      sizes.push(batch.length);
      for (const item of batch) {
        const word = (await db.words.get(item.wordId))!;
        expect((await saveReview(db, answer({ word, track: item.track, at: T0 }))).status).toBe('saved');
      }
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect((await available(db, T0)).count).toBe(0);
    // All 45 answered within one moment, and what they need next is simply due again later.
    expect((await available(db, T0 + 11 * MIN)).count).toBe(45);
  });

  it('due reviews are offered as soon as they are due, however many were answered today', async () => {
    await graduate();
    await saveReview(db, answer({ expected: await stateOf(), at: (await stateOf())!.dueAt }));
    const due = (await stateOf())!.dueAt;
    expect((await available(db, due - 1)).plan.fresh.map((item) => item.track)).toEqual(['tr_de']);
    expect((await available(db, due)).plan.due.map((item) => item.track)).toEqual(['de_tr']);
  });
});
