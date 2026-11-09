import type { Evaluation, QuestionKind } from './answers';
import type { PracticeMode, PracticeScope, RoundItem } from './selection';

/**
 * One round of practice as plain data, with every change a pure function, so a round can be tested
 * without a screen and can survive a page reload.
 */
export type Outcome = 'clean' | 'hinted' | 'wrong';

export interface PracticeSettings {
  mode: PracticeMode;
  scope: PracticeScope;
  count: number | null;
  includeFlagged: boolean;
}

export interface ItemProgress<Kind extends QuestionKind = QuestionKind> {
  wordId: string;
  track: Kind;
  attempts: number;
  first: Outcome | null;
  last: Outcome | null;
  /** Left out because it could not be asked, such as a recording that would not play. Never an answer. */
  skipped?: true;
}

export interface Answered {
  typed: string;
  hinted: boolean;
  evaluation: Evaluation;
  /** The attempt was a repeat, so it did not move the round's progress. */
  retry: boolean;
}

export interface Session {
  id: string;
  settings: PracticeSettings;
  items: ItemProgress[];
  /** Indexes into items. The first is the question on screen. */
  queue: number[];
  hinted: boolean;
  /** Hint stages shown for the question on screen. Any at all makes the attempt hinted. */
  hints: number;
  answered: Answered | null;
}

/** A question is asked at most this many times in a round, so a hard word can never trap anyone. */
export const MAX_ATTEMPTS = 3;
/** Other questions to ask before a repeat, when that many are left. */
const RETRY_GAP = 3;

export function createSession(id: string, settings: PracticeSettings, round: readonly RoundItem[]): Session {
  return { id, settings, items: round.map((item) => ({ ...item, attempts: 0, first: null, last: null })), queue: round.map((_, index) => index), hinted: false, hints: 0, answered: null };
}

export const currentItem = (session: Session): ItemProgress | null => {
  const index = session.queue[0];
  return index === undefined ? null : session.items[index]!;
};

export const isFinished = (session: Session): boolean => session.queue.length === 0;
export const doneCount = (session: Session): number => session.items.filter((item) => item.first !== null).length;
/** Repeats still to come, not counting a question on screen that was already answered. */
export const retriesWaiting = (session: Session): number => session.queue.filter((index, at) => (session.answered ? at > 0 : true) && session.items[index]!.attempts > 0).length;

function spacerFor(session: Session, currentIndex: number): number | null {
  let best: number | null = null;
  session.items.forEach((item, index) => {
    if (index === currentIndex || item.attempts >= MAX_ATTEMPTS || item.skipped) return;
    if (best === null || item.attempts < session.items[best]!.attempts) best = index;
  });
  return best;
}

/**
 * Applies an answer. A question not recalled cleanly comes back after a few others. It never comes back
 * straight away, because its answer has just been shown: with nothing else left, an earlier question is
 * asked between the two, and a question that is alone in its round simply ends.
 */
export function submitAnswer(session: Session, typed: string, evaluation: Evaluation): Session {
  const index = session.queue[0];
  if (index === undefined || session.answered) return session;
  const item = session.items[index]!;
  const outcome: Outcome = !evaluation.correct ? 'wrong' : session.hinted ? 'hinted' : 'clean';
  const retry = item.attempts > 0;
  const updated: ItemProgress = { ...item, attempts: item.attempts + 1, first: item.first ?? outcome, last: outcome };
  const items = session.items.map((entry, at) => (at === index ? updated : entry));

  let rest = session.queue.slice(1);
  if (outcome !== 'clean' && updated.attempts < MAX_ATTEMPTS) {
    if (rest.length > 0) {
      const at = Math.min(RETRY_GAP, rest.length);
      rest = [...rest.slice(0, at), index, ...rest.slice(at)];
    } else {
      const spacer = spacerFor({ ...session, items }, index);
      if (spacer !== null) rest = [spacer, index];
    }
  }
  return { ...session, items, queue: [index, ...rest], answered: { typed, hinted: session.hinted, evaluation, retry } };
}

/** Moves on from the feedback. */
export function nextQuestion(session: Session): Session {
  if (!session.answered) return session;
  return { ...session, queue: session.queue.slice(1), hinted: false, hints: 0, answered: null };
}

/** Shows one more hint stage. The first one already makes the attempt hinted; later ones stay part of that same attempt. */
/**
 * Leaves the question on screen without an answer: it is not wrong, not asked again and not counted. A
 * question already answered once keeps that answer; only this attempt is passed over.
 */
export function skipQuestion(session: Session): Session {
  const index = session.queue[0];
  if (index === undefined || session.answered) return session;
  const items = session.items.map((item, at) => (at === index && item.attempts === 0 ? { ...item, skipped: true as const } : item));
  return { ...session, items, queue: session.queue.slice(1), hinted: false, hints: 0 };
}

/** Questions the round still means to ask or has asked, leaving out any passed over before an answer. */
export const roundSize = (session: Session): number => session.items.filter((item) => !item.skipped).length;

export const markHintUsed = (session: Session): Session => (session.answered ? session : { ...session, hinted: true, hints: session.hints + 1 });

/** Takes a word out, for one deleted while the round was open. Progress on other words stays. */
export function dropWord(session: Session, wordId: string): Session {
  const keep = session.items.map((item) => item.wordId !== wordId);
  const moved = new Map<number, number>();
  let next = 0;
  keep.forEach((kept, index) => {
    if (kept) moved.set(index, next++);
  });
  const current = session.queue[0];
  return {
    ...session,
    items: session.items.filter((_, index) => keep[index]),
    queue: session.queue.filter((index) => keep[index]).map((index) => moved.get(index)!),
    hinted: current !== undefined && keep[current] ? session.hinted : false,
    hints: current !== undefined && keep[current] ? session.hints : 0,
    answered: current !== undefined && keep[current] ? session.answered : null,
  };
}

export interface RoundSummary {
  total: number;
  /** Right on the first try with no help. Repeats never change this number. */
  firstClean: number;
  firstHinted: number;
  firstWrong: number;
  /** Not clean at first, then right without help on a repeat. */
  recovered: number;
  /** Still not clean when the round ended. */
  unresolved: number;
  repeats: number;
  toReview: ItemProgress[];
}

export function summarize(session: { items: readonly ItemProgress[] }): RoundSummary {
  const asked = session.items.filter((item) => item.first !== null);
  const first = (outcome: Outcome) => asked.filter((item) => item.first === outcome).length;
  const toReview = asked.filter((item) => item.first !== 'clean' || item.last !== 'clean');
  return {
    total: asked.length,
    firstClean: first('clean'),
    firstHinted: first('hinted'),
    firstWrong: first('wrong'),
    recovered: asked.filter((item) => item.first !== 'clean' && item.last === 'clean').length,
    unresolved: asked.filter((item) => item.last !== 'clean').length,
    repeats: asked.reduce((sum, item) => sum + item.attempts - 1, 0),
    toReview,
  };
}

const isOutcome = (value: unknown) => value === null || value === 'clean' || value === 'hinted' || value === 'wrong';

/** A round saved before hints had stages counts as having shown one, so a hint is never lost from the attempt. */
export const revivedHints = (value: { hinted?: unknown; hints?: unknown }): number => {
  if (value.hinted !== true) return 0;
  return Number.isInteger(value.hints) && (value.hints as number) > 0 ? (value.hints as number) : 1;
};

/** Brings back a saved round if it still makes sense, without any word that has since been deleted. */
export function reviveSession(raw: unknown, activeIds: ReadonlySet<string>): Session | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<Session>;
  if (typeof value.id !== 'string' || !Array.isArray(value.items) || !Array.isArray(value.queue) || typeof value.settings !== 'object' || value.settings === null) return null;
  const itemsOk = value.items.every((item: ItemProgress) => typeof item?.wordId === 'string' && ['de_tr', 'tr_de', 'article', 'listen'].includes(item.track) && Number.isInteger(item.attempts) && isOutcome(item.first) && isOutcome(item.last) && (item.skipped === undefined || item.skipped === true));
  const queueOk = value.queue.every((index: number) => Number.isInteger(index) && index >= 0 && index < value.items!.length);
  if (!itemsOk || !queueOk) return null;
  let session = { id: value.id, settings: value.settings, items: value.items, queue: value.queue, hinted: value.hinted === true, hints: revivedHints(value), answered: value.answered ?? null } as Session;
  for (const wordId of new Set(session.items.map((item) => item.wordId))) {
    if (!activeIds.has(wordId)) session = dropWord(session, wordId);
  }
  return session.items.length > 0 ? session : null;
}
