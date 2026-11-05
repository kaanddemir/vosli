import type { Issue } from '../core/issues';
import { applyGrade, createFsrsState, phaseOf, SCHEDULER_VERSION, type FsrsState } from '../core/scheduling/fsrs';
import { planReview, type ReviewPlan } from '../core/scheduling/queue';
import { gradeFor } from '../core/scheduling/rating';
import { doubtFrom, tracksFor } from '../core/practice/selection';
import type { Validate } from '../core/validation';
import { readDismissals } from './dismissals';
import type { AppDatabase } from './db';
import { flagsFor, issuesOfWord } from './practice';
import { listActiveWords } from './repository';
import type { AnswerResult, Card, ScheduledLog, Track, Word } from './types';

/** Everything Smart Review chooses from, read at one moment. */
export interface ReviewData {
  words: Word[];
  cards: Card[];
  validate: Validate | null;
  dismissed: ReadonlySet<string>;
  flagged: ReadonlyMap<string, Issue[]>;
  /** The warnings above are known, rather than simply not looked for yet. */
  checked: boolean;
}

export async function loadReviewData(db: AppDatabase, validate: Validate | null): Promise<ReviewData> {
  const [words, cards, dismissed] = await Promise.all([listActiveWords(db), db.cards.toArray(), readDismissals(db)]);
  return { words, cards, validate, dismissed, ...flagsFor(words, validate, dismissed) };
}

/** The open warnings on a word as it stands now. Without the dictionary at hand, what was last found. */
export const issuesFor = (word: Word, data: ReviewData): Issue[] => (data.validate ? issuesOfWord(word, data.validate, data.dismissed) : [...(data.flagged.get(word.id) ?? [])]);

export function planFrom(data: ReviewData, includeFlagged: boolean, now: number): ReviewPlan {
  return planReview({ words: data.words, cards: data.cards, now, doubtOf: (id) => doubtFrom(data.flagged.get(id) ?? []), leftOut: (id) => !includeFlagged && data.flagged.has(id) });
}

/** Words with an open warning that a plan would ask about, if they were included. */
export function flaggedWaiting(data: ReviewData, now: number): Word[] {
  const included = planFrom(data, true, now);
  const ids = new Set([...included.due, ...included.fresh].map((candidate) => candidate.wordId));
  return data.words.filter((word) => data.flagged.has(word.id) && ids.has(word.id));
}

/** How many cards the scheduler wants back soon but not yet. */
export function waitingCards(data: ReviewData, includeFlagged: boolean, now: number): number {
  const words = new Map(data.words.map((word) => [word.id, word]));
  let count = 0;
  for (const card of data.cards) {
    const word = words.get(card.wordId);
    if (!word || card.fsrs.dueAt <= now || phaseOf(card.fsrs) !== 'learning') continue;
    if (!includeFlagged && data.flagged.has(word.id)) continue;
    if (!tracksFor(word, 'mixed', doubtFrom(data.flagged.get(word.id) ?? [])).includes(card.track)) continue;
    count++;
  }
  return count;
}

export interface ReviewOverview {
  words: number;
  due: number;
  fresh: number;
  /** Any skill of any active word has a schedule, so learning has begun. */
  studied: boolean;
  flagged: number;
}

/** What Home says. Counts only what a session could really ask: active words, eligible skills, no open warnings. */
export function overviewOf(data: ReviewData, now: number): ReviewOverview {
  const plan = planFrom(data, false, now);
  const active = new Set(data.words.map((word) => word.id));
  return {
    words: data.words.length,
    due: plan.due.length,
    fresh: plan.fresh.length,
    studied: data.cards.some((card) => active.has(card.wordId) && phaseOf(card.fsrs) !== 'new'),
    flagged: flaggedWaiting(data, now).length,
  };
}

interface CardState {
  word: Word | null;
  card: Card | null;
}

export async function readCardState(db: AppDatabase, wordId: string, track: Track): Promise<CardState> {
  const [word, card] = await Promise.all([db.words.get(wordId), db.cards.get([wordId, track])]);
  return { word: word && word.deletedAt === null ? word : null, card: card ?? null };
}

export interface ReviewAnswer {
  word: Word;
  track: Track;
  /** The card as it stood when the question was shown, or null if it had no schedule yet. */
  expected: FsrsState | null;
  typed: string;
  result: AnswerResult;
  correct: boolean;
  hinted: boolean;
  at: number;
  sessionId: string;
  retry: boolean;
}

type ReviewSaveResult = { status: 'saved'; next: FsrsState } | { status: 'conflict' };

const sameState = (a: FsrsState | null, b: FsrsState | null) => JSON.stringify(a) === JSON.stringify(b);
const sameMeanings = (a: Word, b: Word) => JSON.stringify(a.meanings.map((meaning) => meaning.text)) === JSON.stringify(b.meanings.map((meaning) => meaning.text));

/**
 * Schedules one answer: the card and its history entry are stored together or not at all. The next state
 * is worked out first, then the transaction checks that the card and the word are still what the question
 * was based on. If not, a second press, a reload or another tab got there first, or the word changed,
 * and nothing is written: an answer never overwrites a newer schedule.
 */
export async function saveReview(db: AppDatabase, answer: ReviewAnswer): Promise<ReviewSaveResult> {
  const { word, track, expected, at } = answer;
  const grade = gradeFor(answer.correct, answer.hinted);
  const prevFsrs = expected ?? (await createFsrsState(at));
  const next = await applyGrade(prevFsrs, grade, at);
  return db.transaction('rw', db.words, db.cards, db.reviewLogs, async (): Promise<ReviewSaveResult> => {
    const [stored, card] = await Promise.all([db.words.get(word.id), db.cards.get([word.id, track])]);
    const unchanged = stored && stored.deletedAt === null && stored.lemma === word.lemma && stored.article === word.article && sameMeanings(stored, word);
    if (!unchanged || !sameState(card?.fsrs ?? null, expected)) return { status: 'conflict' };
    const log: ScheduledLog = { mode: 'scheduled', wordId: word.id, track, at, typed: answer.typed, result: answer.result, hintsUsed: answer.hinted ? 1 : 0, grade, prevFsrs, schedulerVersion: SCHEDULER_VERSION, sessionId: answer.sessionId, ...(answer.retry ? { retry: true } : {}) };
    await db.reviewLogs.add(log);
    await db.cards.put({ wordId: word.id, track, fsrs: next, due: next.dueAt, schedulerVersion: SCHEDULER_VERSION });
    return { status: 'saved', next };
  });
}
