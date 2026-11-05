import { identityKey, type Article } from '../../src/core/identity';
import type { FsrsState } from '../../src/core/scheduling/fsrs';
import { SCHEDULER_VERSION } from '../../src/core/scheduling/fsrs';
import type { Card, Word } from '../../src/data/types';

export const T0 = Date.UTC(2026, 0, 1, 9);

export function makeWord(id: string, lemma: string, article: Article | null, meaning: string): Word {
  return {
    id,
    identityKey: identityKey(lemma, article),
    lemma,
    article,
    pos: article ? 'noun' : 'other',
    plural: null,
    meanings: [{ text: meaning, note: null }],
    senseTag: null,
    searchTokens: [lemma.toLowerCase()],
    favoritedAt: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
  };
}

export function makeFsrs(dueAt = T0): FsrsState {
  return { stability: 1, difficulty: 5, dueAt, lastReviewAt: null, state: 0, scheduleStatus: 'new', reps: 0, lapses: 0, scheduledDays: 0, learningStep: 0 };
}

export function makeCard(wordId: string, track: Card['track'] = 'de_tr', due = T0): Card {
  return { wordId, track, due, fsrs: makeFsrs(due), schedulerVersion: SCHEDULER_VERSION };
}

let counter = 0;
export const uniqueDbName = () => `test-${Date.now()}-${counter++}`;
