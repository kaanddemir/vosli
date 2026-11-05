// Runs the data layer against the browser's real IndexedDB. Served by the dev server only.
import { applyGrade, createFsrsState } from '../src/core/scheduling/fsrs';
import { createBackup, exportBackupText, parseBackup, restoreBackup } from '../src/data/backup';
import { MigrationFailedError, NewerSchemaError, openDatabase } from '../src/data/db';
import { blankDraft } from '../src/core/review';
import { deleteGroups } from '../src/data/groups';
import { commitImport } from '../src/data/importCommit';
import { listActiveWords, recordPracticeAttempt } from '../src/data/repository';
import { addWord, deleteWord, updateWord } from '../src/data/words';
import { MIGRATIONS, type Migration } from '../src/data/schema';
import { saveReview } from '../src/data/smartReview';
import { makeCard, makeFsrs, makeWord, T0 } from '../tests/support/fixtures';
import { seedLibrary } from '../tests/support/seed';

const name = (label: string) => `harness-${label}-${crypto.randomUUID()}`;
const DAY = 86_400_000;
const v2: Migration = { version: 2, stores: { notes: '&id' } };

const tests: Record<string, () => Promise<unknown>> = {
  async atomicAnswer() {
    const db = await openDatabase({ name: name('atomic') });
    const word = makeWord('w', 'Apfel', 'der', 'elma');
    await db.words.add(word);
    await db.cards.add(makeCard('w'));
    const failing = () => {
      throw new Error('boom');
    };
    db.reviewLogs.hook('creating', failing);
    const rejected = await saveReview(db, { word, track: 'de_tr', expected: makeFsrs(T0), typed: 'x', result: 'correct', correct: true, hinted: false, at: T0, sessionId: 's', retry: false }).then(() => false, () => true);
    db.reviewLogs.hook('creating').unsubscribe(failing);
    const result = { rejected, due: (await db.cards.get(['w', 'de_tr']))?.due === T0, logs: await db.reviewLogs.count() };
    db.close();
    return result;
  },
  async reviewSavedOnceAcrossTabs() {
    const n = name('tabs');
    const first = await openDatabase({ name: n });
    const second = await openDatabase({ name: n });
    const word = makeWord('w', 'Apfel', 'der', 'elma');
    await first.words.add(word);
    const answer = { word, track: 'de_tr' as const, expected: null, typed: 'elma', result: 'correct' as const, correct: true, hinted: false, at: T0, sessionId: 's', retry: false };
    const results = await Promise.all([saveReview(first, answer), saveReview(second, answer), saveReview(first, answer)]);
    const result = { saved: results.filter((entry) => entry.status === 'saved').length, logs: await first.reviewLogs.count(), reps: (await first.cards.get(['w', 'de_tr']))?.fsrs.reps };
    first.close();
    second.close();
    return result;
  },
  async reviewRollsBack() {
    const db = await openDatabase({ name: name('review') });
    const word = makeWord('w', 'Apfel', 'der', 'elma');
    await db.words.add(word);
    const failing = () => {
      throw new Error('boom');
    };
    db.reviewLogs.hook('creating', failing);
    const rejected = await saveReview(db, { word, track: 'de_tr', expected: null, typed: 'elma', result: 'correct', correct: true, hinted: false, at: T0, sessionId: 's', retry: false }).then(() => false, () => true);
    db.reviewLogs.hook('creating').unsubscribe(failing);
    const result = { rejected, cards: await db.cards.count(), logs: await db.reviewLogs.count() };
    db.close();
    return result;
  },
  async articleChangeResetsOneCard() {
    const db = await openDatabase({ name: name('article') });
    await db.words.add(makeWord('w', 'Apfel', 'der', 'elma'));
    await db.cards.bulkAdd([makeCard('w', 'article'), makeCard('w', 'de_tr'), makeCard('w', 'tr_de')]);
    await updateWord(db, 'w', { lemma: 'Apfel', article: 'die', meanings: ['elma'], plural: null }, T0);
    const result = (await db.cards.toArray()).map((card) => card.track).sort();
    db.close();
    return result;
  },
  async practiceIsolation() {
    const db = await openDatabase({ name: name('practice') });
    await seedLibrary(db);
    const before = JSON.stringify(await db.cards.toArray());
    await recordPracticeAttempt(db, { wordId: 'w-apfel', track: 'de_tr', at: T0, typed: 'x', result: 'wrong', hintsUsed: 0 });
    const same = before === JSON.stringify(await db.cards.toArray());
    db.close();
    return same;
  },
  async backupRoundTrip() {
    const source = await openDatabase({ name: name('src') });
    await seedLibrary(source);
    const text = await exportBackupText(source, T0);
    const target = await openDatabase({ name: name('dst') });
    await target.words.add(makeWord('old', 'Alt', null, 'eski'));
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse failed');
    await restoreBackup(target, parsed.backup);
    const [a, b] = [await createBackup(source, T0), await createBackup(target, T0)];
    const same = (['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows'] as const).every((t) => JSON.stringify(a.tables[t]) === JSON.stringify(b.tables[t]));
    const fuss = (await target.words.get('w-fuss'))?.lemma;
    source.close();
    target.close();
    return { same, fuss };
  },
  async failedRestoreKeepsData() {
    const source = await openDatabase({ name: name('src') });
    await seedLibrary(source);
    const parsed = parseBackup(await exportBackupText(source, T0));
    source.close();
    if (!parsed.ok) throw new Error('parse failed');
    const target = await openDatabase({ name: name('dst') });
    await target.words.add(makeWord('keep', 'Bleiben', null, 'kalmak'));
    const failing = () => {
      throw new Error('boom');
    };
    target.groups.hook('creating', failing);
    const rejected = await restoreBackup(target, parsed.backup).then(() => false, () => true);
    target.groups.hook('creating').unsubscribe(failing);
    const ids = (await target.words.toArray()).map((w) => w.id);
    target.close();
    return { rejected, ids };
  },
  async newerSchemaRefused() {
    const n = name('newer');
    const newer = await openDatabase({ name: n, migrations: [...MIGRATIONS, v2] });
    await newer.words.add(makeWord('a', 'Fuß', 'der', 'ayak'));
    newer.close();
    const error = await openDatabase({ name: n }).catch((e: unknown) => e);
    const again = await openDatabase({ name: n, migrations: [...MIGRATIONS, v2] });
    const result = { refused: error instanceof NewerSchemaError, words: await again.words.count(), verno: again.verno };
    again.close();
    return result;
  },
  async failedMigrationRollsBack() {
    const n = name('mig');
    const db = await openDatabase({ name: n });
    await db.words.add(makeWord('a', 'Fuß', 'der', 'ayak'));
    db.close();
    const bad: Migration = {
      version: 2,
      stores: { notes: '&id' },
      upgrade: async (tx) => {
        await tx.table('words').toCollection().modify((w: Record<string, unknown>) => {
          w.damaged = true;
        });
        throw new Error('migration bug');
      },
    };
    const error = await openDatabase({ name: n, migrations: [...MIGRATIONS, bad] }).catch((e: unknown) => e);
    const again = await openDatabase({ name: n });
    const word = await again.words.get('a');
    const result = { reported: error instanceof MigrationFailedError, lemma: word?.lemma, damaged: word !== undefined && 'damaged' in word, verno: again.verno };
    again.close();
    return result;
  },
  async upgradeClosesOtherConnection() {
    const n = name('tabs');
    let notified = false;
    const first = await openDatabase({ name: n, onClosedByUpgrade: () => (notified = true) });
    const second = await openDatabase({ name: n, migrations: [...MIGRATIONS, v2] });
    const result = { notified, firstOpen: first.isOpen(), secondVersion: second.verno };
    second.close();
    return result;
  },
  async importRollsBack() {
    const db = await openDatabase({ name: name('import') });
    await seedLibrary(db);
    const before = JSON.stringify(await createBackup(db, T0));
    let calls = 0;
    const failing = () => {
      if (++calls === 2) throw new Error('boom');
    };
    db.importRows.hook('creating', failing);
    const drafts = [blankDraft('1', 0, { german: 'Birne', article: 'die', turkish: 'armut' }), blankDraft('2', 1, { german: 'Apfel', article: 'der', turkish: 'elma, alma' })];
    const rejected = await commitImport(db, { source: { fileName: 'a.csv', fileHash: 'h', pipelineVersion: 1 }, drafts, target: { kind: 'new_group', name: 'Yeni' } }, T0).then(() => false, () => true);
    db.importRows.hook('creating').unsubscribe(failing);
    const same = before === JSON.stringify(await createBackup(db, T0));
    db.close();
    return { rejected, same };
  },
  async wordEditAndDelete() {
    const db = await openDatabase({ name: name('lifecycle') });
    await seedLibrary(db);
    const logs = JSON.stringify(await db.reviewLogs.toArray());
    await updateWord(db, 'w-apfel', { lemma: 'Apfelbaum', article: 'der', meanings: ['elma ağacı'], plural: null }, T0);
    const editKeptLogs = JSON.stringify(await db.reviewLogs.toArray()) === logs;
    const editDroppedCards = (await db.cards.where('wordId').equals('w-apfel').count()) === 0 || (await db.cards.toArray()).every((card) => card.wordId !== 'w-apfel');
    const others = (await db.words.count()) - 1;
    await deleteWord(db, 'w-apfel');
    const gone = (await db.words.get('w-apfel')) === undefined && (await db.reviewLogs.where('wordId').equals('w-apfel').count()) === 0 && (await db.groupMembers.where('wordId').equals('w-apfel').count()) === 0;
    const outcome = await addWord(db, { lemma: 'Apfelbaum', article: 'der', meanings: ['elma ağacı'], plural: null }, null, [], T0);
    const fresh = outcome.kind === 'saved' && outcome.word.id !== 'w-apfel' && (await db.reviewLogs.where('wordId').equals(outcome.word.id).count()) === 0;
    const kept = (await db.words.count()) === others + 1 && (await db.sources.count()) === 1 && (await db.groups.count()) === 2;
    db.close();
    return { editKeptLogs, editDroppedCards, gone, fresh, kept };
  },
  async deleteRollsBack() {
    const db = await openDatabase({ name: name('delete') });
    await seedLibrary(db);
    const before = JSON.stringify(await createBackup(db, T0));
    const failing = () => {
      throw new Error('boom');
    };
    db.words.hook('deleting', failing);
    const rejected = await deleteWord(db, 'w-apfel').then(() => false, () => true);
    db.words.hook('deleting').unsubscribe(failing);
    const same = before === JSON.stringify(await createBackup(db, T0));
    db.close();
    return { rejected, same };
  },
  async groupDeleteProtectsData() {
    const db = await openDatabase({ name: name('groups') });
    await seedLibrary(db);
    const words = (await listActiveWords(db)).length;
    const cards = await db.cards.count();
    const logs = await db.reviewLogs.count();
    await deleteGroups(db, ['g-custom']);
    const sourceMember = (await db.groupMembers.get(['g-pdf', 'w-apfel']))?.importRowId;
    await deleteGroups(db, ['g-pdf']);
    const result = { sourceGone: (await db.groups.get('g-pdf')) === undefined, kept: (await listActiveWords(db)).length === words && (await db.cards.count()) === cards && (await db.reviewLogs.count()) === logs, sourceMember };
    db.close();
    return result;
  },
  async fsrsChain() {
    let state = await createFsrsState(T0);
    let now = T0;
    const days: number[] = [];
    for (let i = 0; i < 7; i++) {
      state = await applyGrade(state, 'good', now);
      if (i > 0) days.push(Math.round((state.dueAt - now) / DAY));
      now = state.dueAt;
    }
    return days;
  },
  async fsrsStoredAndContinued() {
    const db = await openDatabase({ name: name('fsrs') });
    let state = await createFsrsState(T0);
    state = await applyGrade(state, 'good', T0);
    await db.cards.add({ wordId: 'w', track: 'de_tr', due: state.dueAt, fsrs: state, schedulerVersion: 'x' });
    const stored = (await db.cards.get(['w', 'de_tr']))!.fsrs;
    const same = JSON.stringify(await applyGrade(stored, 'good', state.dueAt)) === JSON.stringify(await applyGrade(state, 'good', state.dueAt));
    db.close();
    return same;
  },
};

(window as unknown as { runHarness: (test: string) => Promise<unknown> }).runHarness = (test) => tests[test]!();
