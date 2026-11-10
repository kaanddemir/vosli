import type { Issue, IssueCode } from '../issues';
import { isAccepted, NO_DOUBT, type AnswerResult, type AnswerWord, type DictionaryDoubt, type QuestionKind, type Track } from './answers';

/** Listening is chosen as a way of studying, then asked through the same rounds as typed questions. */
export type PracticeMode = Track | 'mixed' | 'listen';

/** Everything chosen is put together; choosing nothing means every word. */
export interface PracticeScope {
  all: boolean;
  favorites: boolean;
  difficult: boolean;
  groupIds: readonly string[];
}

export const ALL_WORDS: PracticeScope = { all: true, favorites: false, difficult: false, groupIds: [] };

export interface SelectableWord extends AnswerWord {
  favoritedAt: number | null;
}

interface Membership {
  groupId: string;
  wordId: string;
}

export interface HistoryEntry {
  wordId: string;
  track: Track;
  at: number;
  result: AnswerResult;
  hintsUsed: number;
  /** A repeat inside a session: the answer had just been shown, so it says little about memory. */
  retry?: boolean;
}

/** Only the warnings a word's text may really be wrong about. A missing article teaches nothing false. */
const QUESTIONABLE: ReadonlySet<IssueCode> = new Set<IssueCode>(['article_wrong', 'article_sense', 'not_a_noun', 'capitalization', 'spelling', 'old_spelling']);
const ARTICLE_ISSUES: ReadonlySet<IssueCode> = new Set<IssueCode>(['article_wrong', 'article_sense', 'not_a_noun']);

export const questionableIssues = (issues: readonly Issue[]): Issue[] => issues.filter((item) => QUESTIONABLE.has(item.code));

export function doubtFrom(issues: readonly Issue[]): DictionaryDoubt {
  if (issues.length === 0) return NO_DOUBT;
  return { article: issues.some((item) => ARTICLE_ISSUES.has(item.code)), offers: issues.flatMap((item) => item.suggestions) };
}

/** The question types a word can honestly be asked. */
export function tracksFor(word: AnswerWord, mode: Exclude<PracticeMode, 'listen'>, doubt: DictionaryDoubt = NO_DOUBT): Track[] {
  const articleOk = word.article !== null && !doubt.article;
  const hasMeaning = word.meanings.length > 0;
  const language: Track[] = hasMeaning ? ['tr_de', 'de_tr'] : [];
  if (mode === 'mixed') return articleOk ? [...language, 'article'] : language;
  if (mode === 'article') return articleOk ? ['article'] : [];
  return language.includes(mode) ? [mode] : [];
}

/**
 * The questions a word can be asked in a practice round. Whether a word has a recording to hear is known
 * only to the screens, which pass listening rounds just the words that have one.
 */
export const questionsFor = (word: AnswerWord, mode: PracticeMode, doubt: DictionaryDoubt = NO_DOUBT): QuestionKind[] => (mode === 'listen' ? ['listen'] : tracksFor(word, mode, doubt));

/** The union of everything chosen. Each word appears once, however many collections hold it. */
export function wordsInScope<T extends SelectableWord>(words: readonly T[], scope: PracticeScope, members: readonly Membership[], difficult: ReadonlySet<string>): T[] {
  if (scope.all) return [...words];
  const chosen = new Set(scope.groupIds);
  const fromGroups = new Set(members.filter((member) => chosen.has(member.groupId)).map((member) => member.wordId));
  return words.filter((word) => (scope.favorites && word.favoritedAt !== null) || (scope.difficult && difficult.has(word.id)) || fromGroups.has(word.id));
}

const DIFFICULT_WINDOW = 5;
const DIFFICULT_MISSES = 2;

/**
 * Words the history says are not yet secure: the latest try was not clean, or two of the latest five
 * were not. Repeats inside a session are left out. A correct answer after a hint is not clean recall.
 */
export function findDifficult(history: readonly HistoryEntry[]): Set<string> {
  const byWord = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    if (entry.retry) continue;
    const list = byWord.get(entry.wordId);
    if (list) list.push(entry);
    else byWord.set(entry.wordId, [entry]);
  }
  const difficult = new Set<string>();
  for (const [wordId, entries] of byWord) {
    const recent = entries.slice(-DIFFICULT_WINDOW);
    const clean = (entry: HistoryEntry) => isAccepted(entry.result) && entry.hintsUsed === 0;
    if (!clean(recent[recent.length - 1]!) || recent.filter((entry) => !clean(entry)).length >= DIFFICULT_MISSES) difficult.add(wordId);
  }
  return difficult;
}

type Random = () => number;

export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export interface RoundItem {
  wordId: string;
  track: QuestionKind;
}

const seenKey = (wordId: string, track: QuestionKind) => `${wordId}|${track}`;

interface RoundInput<T extends AnswerWord> {
  words: readonly T[];
  mode: PracticeMode;
  /** How many questions, or null for every eligible word. */
  count: number | null;
  history: readonly HistoryEntry[];
  doubtOf: (wordId: string) => DictionaryDoubt;
  random: Random;
  /** The question just asked, which should not open the next round. */
  lastAsked?: RoundItem | null;
  /** The questions a word can be asked, when a caller knows more than the word alone says, such as a test. */
  kindsOf?: (word: T) => QuestionKind[];
}

/**
 * One question per word. Words practiced longest ago come first, so rounds move through the whole
 * selection before anything comes back, and there is still never a limit on how many rounds run.
 */
export function buildRound<T extends AnswerWord>({ words, mode, count, history, doubtOf, random, lastAsked = null, kindsOf = (word) => questionsFor(word, mode, doubtOf(word.id)) }: RoundInput<T>): RoundItem[] {
  const seen = new Map<string, number>();
  for (const entry of history) seen.set(seenKey(entry.wordId, entry.track), Math.max(entry.at, seen.get(seenKey(entry.wordId, entry.track)) ?? 0));

  const candidates = shuffled(words, random)
    .map((word) => ({ word, tracks: kindsOf(word) }))
    .filter((candidate) => candidate.tracks.length > 0)
    .map((candidate) => ({ ...candidate, lastSeen: Math.max(...candidate.tracks.map((track) => seen.get(seenKey(candidate.word.id, track)) ?? 0)) }))
    .sort((a, b) => a.lastSeen - b.lastSeen);
  const picked = count === null ? candidates : candidates.slice(0, count);

  // Each word takes the type asked least so far, then the one it saw longest ago. Words with fewer
  // options choose first, or the words that can only be asked two ways would starve the third.
  const asked = new Map<QuestionKind, number>();
  const items = [...picked].sort((a, b) => a.tracks.length - b.tracks.length).map(({ word, tracks }): RoundItem => {
    const best = [...shuffled(tracks, random)].sort((a, b) => (asked.get(a) ?? 0) - (asked.get(b) ?? 0) || (seen.get(seenKey(word.id, a)) ?? 0) - (seen.get(seenKey(word.id, b)) ?? 0))[0]!;
    asked.set(best, (asked.get(best) ?? 0) + 1);
    return { wordId: word.id, track: best };
  });

  const order = shuffled(items, random);
  if (lastAsked && order.length > 1 && order[0]!.wordId === lastAsked.wordId) [order[0], order[1]] = [order[1]!, order[0]!];
  return order;
}
