import type { Issue } from '../core/issues';
import { openIssues } from '../core/issues';
import { findDifficult, questionableIssues } from '../core/practice/selection';
import type { Validate } from '../core/validation';
import { readDismissals } from './dismissals';
import { checkSignature, readCheckedFlags, saveCheckedFlags } from './flaggedCache';
import type { AppDatabase } from './db';
import { listActiveWords, listGroupSummaries, type GroupSummary } from './repository';
import type { GroupMember, LearningLanguage, ReviewLog, Word } from './types';

/** Everything a practice round is chosen from, read once when the round is set up. */
export interface PracticeData {
  words: Word[];
  groups: GroupSummary[];
  members: GroupMember[];
  history: ReviewLog[];
  difficult: ReadonlySet<string>;
  /** Open dictionary warnings by word. Accepted ones are gone, and only doubts about the text count. */
  flagged: ReadonlyMap<string, Issue[]>;
}

/** The open warnings that doubt the word's own text. No dictionary means no doubts. */
export function issuesOfWord(word: Word, validate: Validate | null, dismissed: ReadonlySet<string>): Issue[] {
  if (!validate) return [];
  const article = word.article ?? '';
  return questionableIssues(openIssues(validate(word.lemma, article, word.meanings.map((meaning) => meaning.text).join(', ')), word.lemma, article, dismissed));
}

interface FlagCheck {
  flagged: ReadonlyMap<string, Issue[]>;
  /** False when nobody knows yet: no dictionary at hand, and no earlier answer for exactly this text. */
  checked: boolean;
}

/**
 * Which words have open warnings. An earlier answer is reused only for exactly the same words,
 * accepted warnings and app build, so a stored result can save the wait but never be out of date.
 */
export function flagsFor(words: readonly Word[], validate: Validate | null, dismissed: ReadonlySet<string>, language: LearningLanguage = 'de'): FlagCheck {
  // The dictionary is German. Another language's words are never checked against it, so none has a warning, and
  // nothing is read from or written to the German result stored on this device.
  if (language !== 'de') return { flagged: new Map(), checked: true };
  const signature = checkSignature(words, dismissed);
  if (!validate) {
    const stored = readCheckedFlags(signature);
    return stored ? { flagged: stored, checked: true } : { flagged: new Map(), checked: false };
  }
  const flagged = new Map<string, Issue[]>();
  for (const word of words) {
    const issues = issuesOfWord(word, validate, dismissed);
    if (issues.length) flagged.set(word.id, issues);
  }
  saveCheckedFlags(signature, flagged);
  return { flagged, checked: true };
}

/** One learning language's words, collections and history. Another language's never enter a round. */
export async function loadPracticeData(db: AppDatabase, validate: Validate | null, language: LearningLanguage): Promise<PracticeData> {
  const [words, groups, allMembers, allHistory, dismissed] = await Promise.all([listActiveWords(db, language), listGroupSummaries(db, language), db.groupMembers.toArray(), db.reviewLogs.orderBy('seq').toArray(), readDismissals(db)]);
  const own = new Set(words.map((word) => word.id));
  const members = allMembers.filter((member) => own.has(member.wordId));
  const history = allHistory.filter((entry) => own.has(entry.wordId));
  return { words, groups, members, history, difficult: findDifficult(history), flagged: flagsFor(words, language === 'de' ? validate : null, dismissed, language).flagged };
}
