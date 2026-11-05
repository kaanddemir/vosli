import { SCHEDULER_VERSION } from '../../src/core/scheduling/fsrs';
import type { AppDatabase } from '../../src/data/db';
import { recordPracticeAttempt } from '../../src/data/repository';
import { makeCard, makeFsrs, makeWord, T0 } from './fixtures';

/** A small library that exercises every table and the special characters that matter. */
export async function seedLibrary(db: AppDatabase): Promise<void> {
  await db.words.bulkAdd([
    makeWord('w-apfel', 'Apfel', 'der', 'elma'),
    makeWord('w-fuss', 'Fuß', 'der', 'ayak'),
    makeWord('w-morgen-noun', 'Morgen', 'der', 'sabah'),
    makeWord('w-morgen', 'morgen', null, 'yarın'),
    makeWord('w-spinat', 'Spinat', 'der', 'ıspanak'),
  ]);
  await db.cards.bulkAdd([makeCard('w-apfel', 'de_tr'), makeCard('w-apfel', 'tr_de'), makeCard('w-fuss', 'de_tr', T0 + 86_400_000)]);
  await db.sources.add({ id: 's1', fileName: 'bolum-1.pdf', fileHash: 'hash-1', importedAt: T0, pipelineVersion: 1 });
  await db.groups.bulkAdd([
    { id: 'g-pdf', kind: 'pdf', name: 'bolum-1.pdf', order: 0, sourceId: 's1', createdAt: T0 },
    { id: 'g-custom', kind: 'custom', name: 'Zor', order: 1, sourceId: null, createdAt: T0 },
  ]);
  await db.importRows.add({ id: 'r1', sourceId: 's1', page: 1, rowIndex: 0, german: 'Apfel', article: 'der', turkish: 'elma', flags: [], decision: 'new', wordId: 'w-apfel' });
  await db.groupMembers.bulkAdd([
    { groupId: 'g-pdf', wordId: 'w-apfel', addedAt: T0, importRowId: 'r1' },
    { groupId: 'g-custom', wordId: 'w-apfel', addedAt: T0, importRowId: null },
  ]);
  const scheduled = (await db.cards.get(['w-apfel', 'de_tr']))!;
  const next = makeFsrs(T0 + 600_000);
  await db.reviewLogs.add({ mode: 'scheduled', wordId: 'w-apfel', track: 'de_tr', at: T0, typed: 'elma', result: 'correct', hintsUsed: 0, grade: 'good', prevFsrs: scheduled.fsrs, schedulerVersion: SCHEDULER_VERSION });
  await db.cards.put({ ...scheduled, fsrs: next, due: next.dueAt, schedulerVersion: SCHEDULER_VERSION });
  await recordPracticeAttempt(db, { wordId: 'w-spinat', track: 'tr_de', at: T0, typed: 'der Spinat', result: 'correct', hintsUsed: 0 });
}
