import type { AnswerWord, DictionaryDoubt, Evaluation, Track } from '../practice/answers';
import { tracksFor } from '../practice/selection';
import type { Answered, ItemProgress, Outcome } from '../practice/session';
import { phaseOf, type FsrsState } from './fsrs';
import type { Candidate, ItemKind } from './queue';

/**
 * One Smart Review session as plain data, so it can be tested without a screen and survive a reload.
 * It only says what to ask next. Every schedule lives on the card and comes from the scheduler, so
 * leaving at any moment loses nothing but the place in this list.
 */
export interface ReviewItem extends ItemProgress {
  kind: ItemKind;
  /** When the scheduler wants it again, if that falls inside this session. */
  returnsAt: number | null;
  /** Removed before it was ever asked, so it does not count towards progress. */
  gone?: boolean;
}

type SaveStatus = 'saved' | 'conflict' | 'failed';

interface ReviewAnswered extends Answered {
  save: SaveStatus;
}

export interface ReviewSession {
  id: string;
  includeFlagged: boolean;
  items: ReviewItem[];
  /** Cards not yet asked, in order. */
  queue: number[];
  current: number | null;
  hinted: boolean;
  answered: ReviewAnswered | null;
  ended: boolean;
}

/** A card stays in the session if the scheduler wants it back within this time. The longest step it can give is 15 minutes. */
export const RETURN_WINDOW_MS = 20 * 60_000;
/** Answers to one card in one session. A card still failing after that comes back in a later session instead. */
export const MAX_ASKS = 4;

export function createReviewSession(id: string, includeFlagged: boolean, batch: readonly Candidate[]): ReviewSession {
  return {
    id,
    includeFlagged,
    items: batch.map(({ wordId, track, kind }) => ({ wordId, track, kind, attempts: 0, first: null, last: null, returnsAt: null })),
    queue: batch.map((_, index) => index),
    current: null,
    hinted: false,
    answered: null,
    ended: false,
  };
}

type ReviewStep = { kind: 'question'; index: number } | { kind: 'waiting'; until: number; count: number } | { kind: 'finished' };

/**
 * What comes after the current question. A card the scheduler wants back goes first once its time has
 * come. Otherwise the next unasked card. When only cards with time still to run are left the session
 * waits for them: nothing is brought forward.
 */
export function nextStep(session: ReviewSession, now: number): ReviewStep {
  if (session.ended) return { kind: 'finished' };
  if (session.current !== null) return { kind: 'question', index: session.current };
  let soonest: number | null = null;
  let waiting = 0;
  session.items.forEach((item, index) => {
    if (item.returnsAt === null) return;
    waiting++;
    if (soonest === null || item.returnsAt < session.items[soonest]!.returnsAt!) soonest = index;
  });
  if (soonest !== null && session.items[soonest]!.returnsAt! <= now) return { kind: 'question', index: soonest };
  const unasked = session.queue[0];
  if (unasked !== undefined) return { kind: 'question', index: unasked };
  if (soonest !== null) return { kind: 'waiting', until: session.items[soonest]!.returnsAt!, count: waiting };
  return { kind: 'finished' };
}

const withItem = (session: ReviewSession, index: number, change: Partial<ReviewItem>): ReviewItem[] => session.items.map((item, at) => (at === index ? { ...item, ...change } : item));

/** Puts a question on screen. The same question after a reload keeps its hint, so a reload cannot wipe one from the rating. */
export function askItem(session: ReviewSession, index: number): ReviewSession {
  return { ...session, items: withItem(session, index, { returnsAt: null }), queue: session.queue.filter((entry) => entry !== index), current: index, hinted: session.current === index && session.hinted, answered: null };
}

export type SaveResult = { status: 'saved'; dueAt: number } | { status: 'conflict' | 'failed' };

/**
 * Applies an answer whose saving has finished. An answer that was not saved changes nothing about the
 * card, so it does not count and the card simply stays due for a later session.
 */
export function recordAnswer(session: ReviewSession, typed: string, evaluation: Evaluation, save: SaveResult, now: number): ReviewSession {
  const index = session.current;
  if (index === null || session.answered) return session;
  const item = session.items[index]!;
  const answered: ReviewAnswered = { typed, hinted: session.hinted, evaluation, retry: item.attempts > 0, save: save.status };
  if (save.status !== 'saved') return { ...session, answered, items: withItem(session, index, item.attempts === 0 ? { gone: true } : {}) };
  const outcome: Outcome = !evaluation.correct ? 'wrong' : session.hinted ? 'hinted' : 'clean';
  const attempts = item.attempts + 1;
  const returnsAt = attempts < MAX_ASKS && save.dueAt - now <= RETURN_WINDOW_MS ? save.dueAt : null;
  return { ...session, answered, items: withItem(session, index, { attempts, first: item.first ?? outcome, last: outcome, returnsAt }) };
}

/** Moves on from the feedback. */
export const leaveFeedback = (session: ReviewSession): ReviewSession => ({ ...session, current: null, hinted: false, answered: null });

export const markReviewHint = (session: ReviewSession): ReviewSession => (session.answered ? session : { ...session, hinted: true });

export const endSession = (session: ReviewSession): ReviewSession => ({ ...session, current: null, hinted: false, answered: null, ended: true });

/** Takes a card out, for one deleted, changed or already answered somewhere else. Earlier answers stay counted. */
export function dropItem(session: ReviewSession, index: number): ReviewSession {
  const asked = session.items[index]!.attempts > 0;
  const leaving = session.current === index;
  return {
    ...session,
    items: withItem(session, index, asked ? { returnsAt: null } : { returnsAt: null, gone: true }),
    queue: session.queue.filter((entry) => entry !== index),
    current: leaving ? null : session.current,
    hinted: leaving ? false : session.hinted,
    answered: leaving ? null : session.answered,
  };
}

/** The stored card says later than this session thought, because another tab answered it first. */
export function delayItem(session: ReviewSession, index: number, dueAt: number): ReviewSession {
  return { ...session, items: withItem(session, index, { returnsAt: dueAt }), queue: session.queue.filter((entry) => entry !== index), current: session.current === index ? null : session.current };
}

export const askedCount = (session: ReviewSession): number => session.items.filter((item) => item.first !== null).length;
export const totalCount = (session: ReviewSession): number => session.items.filter((item) => !item.gone).length;
/** Cards coming back, not counting the one whose feedback is on screen until it is left behind. */
export const returningCount = (session: ReviewSession): number => session.items.filter((item) => item.returnsAt !== null).length;

interface ItemCheck {
  /** The stored word, or null if it is gone or deleted. */
  word: AnswerWord | null;
  card: { fsrs: FsrsState } | null;
  doubt: DictionaryDoubt;
  /** The word has an open warning and this session does not include those. */
  leftOut: boolean;
}

type Verdict = { kind: 'ask' } | { kind: 'drop' } | { kind: 'later'; dueAt: number };

/** Read against stored data just before a question is shown, which is what stops a replay after a reload or in a second tab. */
export function verdictFor(item: { track: Track; attempts: number }, { word, card, doubt, leftOut }: ItemCheck, now: number): Verdict {
  if (!word || leftOut || !tracksFor(word, 'mixed', doubt).includes(item.track)) return { kind: 'drop' };
  const isStarted = card !== null && phaseOf(card.fsrs) !== 'new';
  // Answered here before, and now there is no schedule: its answer changed and it starts over later.
  if (!isStarted) return item.attempts > 0 ? { kind: 'drop' } : { kind: 'ask' };
  if (card.fsrs.dueAt <= now) return { kind: 'ask' };
  return item.attempts > 0 && card.fsrs.dueAt - now <= RETURN_WINDOW_MS ? { kind: 'later', dueAt: card.fsrs.dueAt } : { kind: 'drop' };
}

const isOutcome = (value: unknown) => value === null || value === 'clean' || value === 'hinted' || value === 'wrong';

/** Brings back a saved session if it still makes sense. Whether its cards can still be asked is checked one by one, by verdictFor. */
export function reviveReviewSession(raw: unknown): ReviewSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<ReviewSession>;
  if (typeof value.id !== 'string' || !Array.isArray(value.items) || !Array.isArray(value.queue)) return null;
  const size = value.items.length;
  const itemsOk = value.items.every((item: ReviewItem) => typeof item?.wordId === 'string' && ['de_tr', 'tr_de', 'article'].includes(item.track) && ['new', 'learning', 'review'].includes(item.kind) && Number.isInteger(item.attempts) && isOutcome(item.first) && isOutcome(item.last) && (item.returnsAt === null || typeof item.returnsAt === 'number'));
  const isIndex = (index: unknown) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < size;
  const current = value.current ?? null;
  if (!itemsOk || !value.queue.every(isIndex) || (current !== null && !isIndex(current))) return null;
  return { id: value.id, includeFlagged: value.includeFlagged === true, items: value.items, queue: value.queue, current, hinted: value.hinted === true, answered: current === null ? null : value.answered ?? null, ended: value.ended === true };
}
