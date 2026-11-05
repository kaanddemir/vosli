import type { Track } from '../practice/answers';
import { tracksFor } from '../practice/selection';
import { NO_DOUBT, type AnswerWord, type DictionaryDoubt } from '../practice/answers';
import { phaseOf, type FsrsState } from './fsrs';

/**
 * Decides what Smart Review may ask right now, from stored data alone. A card row exists only once a
 * skill has really been studied, so importing words schedules nothing: until then a skill is simply new.
 */
export type ItemKind = 'new' | 'learning' | 'review';

/** One session asks this many cards for the first time. It is not a daily limit: another session can follow at once. */
export const SESSION_SIZE = 20;

/** Recognising a word comes before producing it, and producing it before its article on its own. */
const INTRODUCTION_ORDER: readonly Track[] = ['de_tr', 'tr_de', 'article'];

export interface PlanWord extends AnswerWord {
  createdAt: number;
}

export interface PlanCard {
  wordId: string;
  track: Track;
  fsrs: FsrsState;
}

export interface Candidate {
  wordId: string;
  track: Track;
  kind: ItemKind;
  /** When the scheduler asked for it. For a new card, when the word was added. */
  since: number;
}

export interface ReviewPlan {
  /** Every card due now, siblings included. This is the number Home shows. */
  due: Candidate[];
  /** At most one per word: the next skill of a word with nothing else going on. */
  fresh: Candidate[];
}

interface PlanInput {
  words: readonly PlanWord[];
  cards: readonly PlanCard[];
  doubtOf?: (wordId: string) => DictionaryDoubt;
  /** Words kept out of this plan, such as those with an open dictionary warning. */
  leftOut?: (wordId: string) => boolean;
  now: number;
}

const started = (card: PlanCard | undefined): card is PlanCard => card !== undefined && phaseOf(card.fsrs) !== 'new';

/**
 * A second skill of a word is not introduced while the first is still being learned, or while another
 * skill of the word is due: the answer to one gives away the other. Cards for a skill a word can no
 * longer be asked, such as an article it lost, are never looked at.
 */
export function planReview({ words, cards, doubtOf = () => NO_DOUBT, leftOut = () => false, now }: PlanInput): ReviewPlan {
  const byWord = new Map<string, PlanCard[]>();
  for (const card of cards) {
    const list = byWord.get(card.wordId);
    if (list) list.push(card);
    else byWord.set(card.wordId, [card]);
  }

  const plan: ReviewPlan = { due: [], fresh: [] };
  for (const word of words) {
    if (leftOut(word.id)) continue;
    const tracks = tracksFor(word, 'mixed', doubtOf(word.id));
    const own = byWord.get(word.id) ?? [];
    const cardOf = (track: Track) => own.find((card) => card.track === track);
    const active = tracks.map(cardOf).filter(started);
    const dueNow = active.filter((card) => card.fsrs.dueAt <= now);
    for (const card of dueNow) plan.due.push({ wordId: word.id, track: card.track, kind: phaseOf(card.fsrs) === 'review' ? 'review' : 'learning', since: card.fsrs.dueAt });
    if (dueNow.length > 0 || active.some((card) => phaseOf(card.fsrs) === 'learning')) continue;
    const next = INTRODUCTION_ORDER.find((track) => tracks.includes(track) && !started(cardOf(track)));
    if (next) plan.fresh.push({ wordId: word.id, track: next, kind: 'new', since: word.createdAt });
  }
  return plan;
}

const byKey = (a: Candidate, b: Candidate) => (a.wordId < b.wordId ? -1 : a.wordId > b.wordId ? 1 : a.track < b.track ? -1 : 1);

/**
 * The next session: cards in learning first because their timing is shortest, then reviews with the
 * longest overdue first, and only then new words, oldest first. One card per word, because feedback on
 * one skill shows the answer to the others. Those wait for the next session.
 */
export function batchFrom({ due, fresh }: ReviewPlan, random: () => number, size = SESSION_SIZE): Candidate[] {
  const sorted = [...due].sort((a, b) => Number(a.kind === 'review') - Number(b.kind === 'review') || a.since - b.since || byKey(a, b));
  const seen = new Set<string>();
  const firstPerWord = sorted.filter((candidate) => {
    if (seen.has(candidate.wordId)) return false;
    seen.add(candidate.wordId);
    return true;
  });
  // Words imported together share a date, and a shuffle keeps a list from always opening the same way.
  const keyed = fresh.map((candidate) => ({ candidate, key: random() }));
  const newest = keyed.sort((a, b) => a.candidate.since - b.candidate.since || a.key - b.key).map((entry) => entry.candidate);
  return [...firstPerWord, ...newest.filter((candidate) => !seen.has(candidate.wordId))].slice(0, size);
}
